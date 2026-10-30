import { describe, expect, it, vi } from "vitest";
import type { ResponseInputItem, ResponseOutputItem } from "openai/resources/responses/responses";
import { dispatchResponseOutput } from "../agent-tool-dispatch/dispatch.js";
import type { ToolDispatchContext } from "../agent-tool-dispatch/types.js";
import { GET_CONTEXT_REMAINING_TOOL_NAME, NEW_CONTEXT_TOOL_NAME, NOTES_WRITE_FILE_TOOL_NAME } from "../agent-tools/index.js";
import { buildContextReminder, CONTEXT_EXHAUSTED_FALLBACK } from "../context-management-v2/prompts.js";
import { getContextWindowTokenStatus } from "../context-management-v2/token-usage.js";
import { resolveContextManagementState } from "../context-management-v2/window.js";
import type { ContextManagementV2State } from "../context-management-v2/types.js";
import type { RunContextStore } from "./ports/run-control.js";
import type { AgentExecutionContext } from "./execution-types.js";
import { maybeAdvanceV2ContextWindow, prepareV2ContextWindowUsage } from "./context-window-budget.js";
import { resetV2ContextWindow } from "./context-window.js";
import { appendPromptEnvelopeDelta, createPromptEnvelope } from "./prompt-envelope.js";

function createFixture() {
  const history = new Map<string, ResponseInputItem[]>();
  let continuity = "";
  const window = { firstWindowId: "window-1", windowId: "window-1", contextNodeId: "node-1", previousWindowId: null };
  const store = {
    freezeVersion: vi.fn(async () => "v2" as const),
    openWindow: vi.fn(async () => window),
    loadWindowItems: vi.fn(async (id: string) => history.get(id) ?? []),
    loadLastCallNumber: vi.fn(async () => 0),
    recordItems: vi.fn(async (state, records) => {
      history.set(state.windowId, [...(history.get(state.windowId) ?? []), ...records.map((record) => record.item)]);
    }),
    startNewWindow: vi.fn(async () => ({ ...window, windowId: "window-2", contextNodeId: "node-2", previousWindowId: "window-1" })),
    linkVisibleMessage: vi.fn(async () => "node-2"),
    loadNotesSummary: vi.fn(async () => ({ continuity, index: [] })),
    freezeWindowPrompt: vi.fn(async (_state, items) => items),
    writeNote: vi.fn(async (_state, input) => {
      continuity = input.text;
      return { updated: true };
    })
  } satisfies Partial<RunContextStore>;
  const context: ContextManagementV2State = {
    version: "v2", taskId: "task-1", ...window, branchLeafMessageId: null,
    reminderSent: false, fallbackSent: false, pendingReset: false, recoveryPhase: "normal"
  };
  const execution = {
    systemPrompt: "system prompt",
    promptEnvelope: createPromptEnvelope("system prompt"),
    prepared: {
      maxContextTokens: 256_000, runtimeModel: "test", snapshot: { platform_model_metadata: {} },
      control: { context: store, appendMessage: vi.fn(async () => "checkpoint-1"), selectBranch: vi.fn() }
    },
    state: {
      contextManagement: context, currentLeafMessageId: null,
      dispatchState: {
        conversationItems: [{ role: "assistant", content: "Previous sampled response." }],
        runPersistedItems: [], commandStep: 0
      }
    }
  } as unknown as AgentExecutionContext;
  const usage = prepareV2ContextWindowUsage(execution)!;
  usage.lastResponseTotalTokens = 230_400;
  return { execution, store, history, usage };
}

async function callContextTool(execution: AgentExecutionContext, name: string, args = {}) {
  const state = execution.state.dispatchState;
  await dispatchResponseOutput([{
    type: "function_call", call_id: `call-${state.conversationItems.length}`, name, arguments: JSON.stringify(args)
  } as ResponseOutputItem], {
    contextManagementV2: execution.state.contextManagement,
    control: execution.prepared.control,
    compatibilityModes: [], assertNotCancelled: async () => {}
  } as ToolDispatchContext, state);
  const output = state.conversationItems.at(-1) as { output: string };
  return JSON.parse(output.output);
}

describe("V2 checkpoint interval", () => {
  it("includes setup prompt deltas before the first provider usage sample", async () => {
    const { execution, usage, store } = createFixture();
    execution.prepared.maxContextTokens = 10_000;
    usage.lastResponseTotalTokens = null;
    execution.state.dispatchState.conversationItems = [];
    appendPromptEnvelopeDelta(execution.promptEnvelope, { reason: "setup", content: "x".repeat(12_000) });

    await maybeAdvanceV2ContextWindow(execution);

    expect(execution.state.contextManagement).toMatchObject({ reminderSent: true, fallbackSent: false });
    expect(store.startNewWindow).not.toHaveBeenCalled();
    expect(store.recordItems).toHaveBeenCalledTimes(1);
  });

  it("lets the agent save a durable note and request a new window after the base budget is exhausted", async () => {
    const { execution, store, history } = createFixture();
    await maybeAdvanceV2ContextWindow(execution);
    expect(store.startNewWindow).not.toHaveBeenCalled();
    expect(execution.state.contextManagement).toMatchObject({ reminderSent: true, fallbackSent: true, recoveryPhase: "normal" });
    expect(execution.state.dispatchState.conversationItems).toContainEqual(expect.objectContaining({ content: expect.stringContaining(CONTEXT_EXHAUSTED_FALLBACK) }));
    expect(await callContextTool(execution, GET_CONTEXT_REMAINING_TOOL_NAME)).toMatchObject({ tokens_left: 0 });

    await callContextTool(execution, NOTES_WRITE_FILE_TOOL_NAME, { path: "notes/continuity.md", text: "Saved goal and next steps." });
    await maybeAdvanceV2ContextWindow(execution);
    expect(store.startNewWindow).not.toHaveBeenCalled();
    await callContextTool(execution, NEW_CONTEXT_TOOL_NAME);
    expect(execution.state.dispatchState.pendingContextV2Reset).toBe(true);
    await resetV2ContextWindow(execution, "manual");

    expect(store.writeNote).toHaveBeenCalledWith(expect.objectContaining({ windowId: "window-1" }), {
      path: "notes/continuity.md", text: "Saved goal and next steps.", append: false
    });
    expect(history.get("window-1")?.some((item) => item.type === "function_call_output")).toBe(true);
    expect(execution.state.dispatchState.conversationItems).toContainEqual(expect.objectContaining({ content: expect.stringContaining("Saved goal and next steps.") }));
    expect(execution.state.dispatchState.contextWindowUsage).toBeNull();
    expect(execution.state.contextManagement).toMatchObject({ windowId: "window-2", reminderSent: false, fallbackSent: false });
    expect(getContextWindowTokenStatus(prepareV2ContextWindowUsage(execution)!, execution.state.dispatchState.conversationItems).tokensRemaining).toBeGreaterThan(0);
  });

  it("restores one-time prompt state when resuming the same window", async () => {
    const { execution, store, history } = createFixture();
    await maybeAdvanceV2ContextWindow(execution);
    const persisted = execution.state.dispatchState.runPersistedItems;
    expect(persisted).toHaveLength(2);
    expect(history.get("window-1")).toEqual(persisted);
    const resumed = await resolveContextManagementState(store as RunContextStore, {
      taskId: "task-1", requestedVersion: "v2", runtimeModel: "test", branchLeafMessageId: null, seedItems: []
    });
    execution.state.contextManagement = resumed.state;
    execution.state.dispatchState.conversationItems.push(...resumed.conversationItems);
    await maybeAdvanceV2ContextWindow(execution);
    expect(execution.state.contextManagement).toMatchObject({ reminderSent: true, fallbackSent: true });
    expect(store.recordItems).toHaveBeenCalledTimes(2);
  });

  it.each([
    { size: 256_000, limit: 243_200 },
    { size: 1_000_000, limit: 916_384 }
  ])("forces rollover at $limit tokens, including newly added tool output", async ({ size, limit }) => {
    const { execution, usage, store } = createFixture();
    execution.prepared.maxContextTokens = size;
    usage.lastResponseTotalTokens = limit - 1;
    await maybeAdvanceV2ContextWindow(execution);
    expect(store.startNewWindow).not.toHaveBeenCalled();
    execution.state.dispatchState.conversationItems.push({ type: "function_call_output", call_id: "tail", output: "x".repeat(4_000) });
    await maybeAdvanceV2ContextWindow(execution);
    expect(store.startNewWindow).toHaveBeenCalledTimes(1);
    expect(execution.state.contextManagement).toMatchObject({ windowId: "window-2" });
  });

  it("sends an early reminder without entering fallback or replacing the conversation", async () => {
    const { execution, usage, store } = createFixture();
    usage.lastResponseTotalTokens = usage.budget.baseLimit - 6_144;
    await maybeAdvanceV2ContextWindow(execution);
    expect(execution.state.contextManagement).toMatchObject({ reminderSent: true, fallbackSent: false });
    expect(store.startNewWindow).not.toHaveBeenCalled();
    expect(execution.state.dispatchState.runPersistedItems).toEqual([
      expect.objectContaining({ content: expect.stringContaining(buildContextReminder(6_144)) })
    ]);
  });

  it("uses the same active-window calculation for remaining tokens and rollover", async () => {
    const { execution, usage } = createFixture();
    usage.lastResponseTotalTokens = 200_000;
    execution.state.dispatchState.contextUsage = { usedTokens: 190_000, maxContextTokens: 256_000, percent: 74 };
    const beforeCall = execution.state.dispatchState.conversationItems;
    const expected = getContextWindowTokenStatus(usage, [
      ...beforeCall,
      { type: "function_call", call_id: `call-${beforeCall.length}`, name: GET_CONTEXT_REMAINING_TOOL_NAME, arguments: "{}" }
    ]).tokensRemaining;
    expect(await callContextTool(execution, GET_CONTEXT_REMAINING_TOOL_NAME)).toMatchObject({ tokens_left: expected });
  });
});
