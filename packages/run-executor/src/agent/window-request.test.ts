import { describe, expect, it, vi } from "vitest";
import type { FunctionTool, ResponseInputItem } from "openai/resources/responses/responses";
import type { AgentExecutionContext } from "./execution-types.js";
import type { RunContextStore } from "./ports/run-control.js";
import type { WindowRequestState } from "./window-request-types.js";
import { appendPromptEnvelopeDelta, createPromptEnvelope } from "./prompt-envelope.js";
import { buildAgentTurnRequest } from "./turn-request.js";
import { prepareWindowTurnRequest, resetWindowRequestSetup } from "./window-request.js";
import { appendQueuedPromptDeltas } from "./queued-prompt-deltas.js";
import { appendRuntimeNotice, persistRuntimeNotices } from "./runtime-notices.js";
import { normalizeProviderRequestInput } from "./provider-request-input.js";
import type { ModelToolChoice } from "./model.js";

const options = { webSearch: false, memorySearch: false, scheduleTask: false, subtasks: false,
  computerUse: false, enabledSkills: [], enabledSources: [] };

function fixture() {
  const snapshots = new Map<string, WindowRequestState>();
  const history: ResponseInputItem[] = [];
  const store = {
    prepareWindowRequest: vi.fn(async (window, request, idle) => {
      const saved = snapshots.get(window.windowId);
      const next = saved ? { ...saved, tools: idle ? saved.tools : request.tools,
        toolChoice: idle ? saved.toolChoice : request.toolChoice } : request;
      snapshots.set(window.windowId, structuredClone(next));
      return structuredClone(next);
    }),
    recordItems: vi.fn(async (_window, records) => { history.push(...structuredClone(records.map(({ item }) => item))); })
  } satisfies Pick<RunContextStore, "prepareWindowRequest" | "recordItems">;
  function execution(prompt: string, items: ResponseInputItem[] = [{ role: "user", content: "Task" }], idle = false) {
    return {
      job: { taskId: "task", mode: idle ? "compact_only" : "default", contextAction: idle ? "idle" : undefined },
      prepared: { control: { context: store }, runShellMaxTimeoutSeconds: 60 },
      promptEnvelope: createPromptEnvelope(prompt),
      state: { contextManagement: { version: "v2", taskId: "task", windowId: "w1", contextNodeId: "n1" },
        dispatchState: { conversationItems: structuredClone(items), runPersistedItems: [] } }
    } as unknown as AgentExecutionContext;
  }
  async function request(execution: AgentExecutionContext, availability = {}, codeMode = false,
    activeSkillTools: FunctionTool[] = [], toolChoice: ModelToolChoice = "auto") {
    const turn = await prepareWindowTurnRequest(execution, buildAgentTurnRequest({ taskId: "task", runToolOptions: options,
      activeSkillTools, promptEnvelope: execution.promptEnvelope,
      availability: { runShellMaxTimeoutSeconds: 60, ...availability }, codeMode }), toolChoice);
    await appendQueuedPromptDeltas(execution);
    return { turn, input: structuredClone([...turn.promptPrefixItems, ...execution.state.dispatchState.conversationItems]) };
  }
  return { execution, request, store, history };
}

describe("context-window request replay", () => {
  it("does not rewrite the stored recipe on unchanged model turns", async () => {
    const f = fixture();
    const execution = f.execution("Policy");
    const before = await f.request(execution);
    const after = await f.request(execution);
    expect(after.turn).toEqual(before.turn);
    expect(f.store.prepareWindowRequest).toHaveBeenCalledOnce();
  });

  it("preserves the previous tool choice through idle and updates it after a real turn", async () => {
    const f = fixture();
    await f.request(f.execution("Infinite policy"), {}, false, [], "required");
    const idle = await f.request(f.execution("Default policy", [], true));
    expect(idle.turn.toolChoice).toBe("required");
    await f.request(f.execution("Default policy"));
    expect((await f.request(f.execution("Default policy", [], true))).turn.toolChoice).toBe("auto");
  });

  it("does not force a tool choice after that tool has been revoked", async () => {
    const f = fixture();
    await f.request(f.execution("Policy"), { allowFinalResponse: true }, false, [], { type: "function", name: "final_response" });
    const idle = await f.request(f.execution("Policy", [], true), { allowFinalResponse: false });
    expect(idle.turn.toolChoice).toBe("auto");
  });

  it("keeps the original prefix and delivers mutable memory/outline state as a persisted tail update", async () => {
    const f = fixture();
    const first = f.execution("Memory before");
    const before = await f.request(first);
    const resumed = f.execution("Memory after", first.state.dispatchState.conversationItems);
    appendPromptEnvelopeDelta(resumed.promptEnvelope, { reason: "organization", content: "outline_exists=true" });
    const after = await f.request(resumed);
    expect(after.turn.promptCacheKey).toBe(before.turn.promptCacheKey);
    expect(after.input.slice(0, before.input.length)).toEqual(before.input);
    expect(after.input.at(-1)).toMatchObject({ role: "developer", content: expect.stringContaining("Memory after") });
    expect(f.history).toHaveLength(1);
    expect(normalizeProviderRequestInput(after.input, "google").slice(0, before.input.length))
      .toEqual(normalizeProviderRequestInput(before.input, "google"));
    const again = f.execution("Memory after", resumed.state.dispatchState.conversationItems);
    appendPromptEnvelopeDelta(again.promptEnvelope, { reason: "organization", content: "outline_exists=true" });
    expect((await f.request(again)).input).toEqual(after.input);
    const reverted = f.execution("Memory before", again.state.dispatchState.conversationItems);
    const reset = await f.request(reverted);
    expect(reset.input).toHaveLength(after.input.length + 1);
    expect(reset.turn.promptCacheKey).toBe(before.turn.promptCacheKey);
  });

  it.each([false, true])("inherits the last infinite request's tools for idle without expanding them (code mode %s)", async (codeMode) => {
    const f = fixture();
    const before = await f.request(f.execution("Infinite policy"), { allowFinalResponse: false }, codeMode);
    const idle = f.execution("Default policy", [{ role: "user", content: "Task" }], true);
    const after = await f.request(idle, { allowFinalResponse: true }, codeMode);
    expect(after.turn.responseTools).toEqual(before.turn.responseTools);
    expect(after.turn.codeModeTools).toEqual(before.turn.codeModeTools);
    expect(after.turn.promptCacheKey).toBe(before.turn.promptCacheKey);
    expect(after.input).toEqual(before.input);
    expect(f.history).toHaveLength(0);
  });

  it("drops revoked tools even when the idle snapshot had them", async () => {
    const f = fixture();
    const before = await f.request(f.execution("Policy"), { allowFinalResponse: true });
    const after = await f.request(f.execution("Policy", [], true), { allowFinalResponse: false });
    expect(after.turn.responseTools.some((tool) => tool.type === "function" && tool.name === "final_response")).toBe(false);
    expect(after.turn.promptCacheKey).not.toBe(before.turn.promptCacheKey);
  });

  it("keeps idle exec documentation stable when ordinary mode exposes additional scheduling tools", async () => {
    const f = fixture();
    const before = await f.request(f.execution("Recurring policy"), {}, true);
    const extra: FunctionTool = { type: "function", name: "schedule_task", description: "Schedule", strict: false,
      parameters: { type: "object", properties: {}, required: [] } };
    const after = await f.request(f.execution("Default policy", [], true), {}, true, [extra]);
    expect(after.turn.responseTools).toEqual(before.turn.responseTools);
    expect(after.turn.codeModeTools).toEqual(before.turn.codeModeTools);
    expect(after.turn.promptCacheKey).toBe(before.turn.promptCacheKey);
  });

  it("does not restore removed source tools through exec", async () => {
    const f = fixture();
    const extra: FunctionTool = { type: "function", name: "private_source__read", description: "Private source", strict: false,
      parameters: { type: "object", properties: {}, required: [] } };
    await f.request(f.execution("Policy"), {}, true, [extra]);
    const after = await f.request(f.execution("Policy", [], true), {}, true);
    expect(after.turn.codeModeTools.some((tool) => tool.name === extra.name)).toBe(false);
    expect(JSON.stringify(after.turn.responseTools)).not.toContain(extra.name);
  });

  it("updates computer readiness at the tail while keeping consented schemas stable", async () => {
    const f = fixture();
    const first = f.execution("Policy");
    const before = await f.request(first);
    const resumed = f.execution("Policy", first.state.dispatchState.conversationItems);
    appendPromptEnvelopeDelta(resumed.promptEnvelope, { reason: "computer", content: "Desktop disconnected" });
    const after = await f.request(resumed);
    expect(after.turn.responseTools).toEqual(before.turn.responseTools);
    expect(after.turn.promptCacheKey).toBe(before.turn.promptCacheKey);
    expect(after.input.at(-1)).toMatchObject({ content: expect.stringContaining("Desktop disconnected") });
  });

  it("starts a fresh snapshot on rollover instead of reverting to stale setup", async () => {
    const f = fixture();
    await f.request(f.execution("Old memory"));
    const resumed = f.execution("New memory");
    const before = await f.request(resumed);
    resetWindowRequestSetup(resumed);
    Object.assign(resumed.state.contextManagement, { windowId: "w2" });
    resumed.state.dispatchState.conversationItems.length = 0;
    const after = await f.request(resumed);
    expect(after.turn.promptPrefixItems[0]).toMatchObject({ content: "New memory" });
    expect(after.turn.promptCacheKey).not.toBe(before.turn.promptCacheKey);
  });

  it("replays temporary wrap-up and runtime notices before appending a new run-state update", async () => {
    const f = fixture();
    const execution = f.execution("Policy");
    const before = await f.request(execution);
    appendPromptEnvelopeDelta(execution.promptEnvelope, { reason: "timed-run-finalizing", runScoped: true,
      content: "The timed task's deadline has been reached. Wrap up." });
    await appendQueuedPromptDeltas(execution);
    appendRuntimeNotice(execution, { role: "user", content: "[System: One step left]" });
    await persistRuntimeNotices(execution);
    const sent = structuredClone(execution.state.dispatchState.conversationItems);
    expect(f.history).toEqual(sent.slice(1));
    const restarted = f.execution("Policy", [sent[0], ...f.history]);
    const after = await f.request(restarted);
    expect(after.input.slice(0, before.turn.promptPrefixItems.length + sent.length)).toEqual([...before.turn.promptPrefixItems, ...sent]);
    expect(after.input.at(-1)).toMatchObject({ content: expect.stringContaining("A new task run has started") });
  });
});
