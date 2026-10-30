import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { ContextNotesSummary, RunContextStore } from "../agent/ports/run-control.js";
import type { ContextManagementV2State } from "./types.js";
import { buildV2WindowDeveloperItems } from "./window.js";
import { createPromptEnvelope } from "../agent/prompt-envelope.js";
import { buildAgentTurnRequest } from "../agent/turn-request.js";
import { createModelResponse } from "../agent/model.js";
import type { ModelGatewayRequest, ModelGatewayResult } from "../agent/ports/model-gateway.js";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { runIdleCompaction } from "../agent/idle-compaction.js";

vi.mock("../agent/context-window.js", () => ({ resetV2ContextWindow: vi.fn(async () => {}) }));

const state: ContextManagementV2State = {
  version: "v2", taskId: "task-1", firstWindowId: "window-1", windowId: "window-1",
  contextNodeId: "node-1", previousWindowId: null, branchLeafMessageId: null,
  reminderSent: false, pendingReset: false, recoveryPhase: "normal"
};

function fixture() {
  const snapshots = new Map<string, ResponseInputItem[]>();
  const loadNotesSummary = vi.fn(async (): Promise<ContextNotesSummary> => ({
    continuity: "Opening notes", index: [{ path: "continuity.md", size: 13, updatedAt: "2026-10-29T12:00:00Z" }]
  }));
  // Persist JSON, rather than references shared with a running execution.
  const store = () => ({
    loadNotesSummary,
    freezeWindowPrompt: async (window, items) => {
      if (!snapshots.has(window.windowId)) snapshots.set(window.windowId, structuredClone(items));
      return structuredClone(snapshots.get(window.windowId)!);
    }
  } satisfies Pick<RunContextStore, "loadNotesSummary" | "freezeWindowPrompt">);
  return { store, loadNotesSummary };
}

async function request(windowItems: ResponseInputItem[], tail: ResponseInputItem[] = []) {
  const turn = buildAgentTurnRequest({
    taskId: state.taskId, activeSkillTools: [], promptEnvelope: createPromptEnvelope("Task prompt"),
    runToolOptions: { webSearch: false, memorySearch: false, scheduleTask: false, subtasks: false,
      computerUse: false, enabledSkills: [], enabledSources: [] },
    availability: { contextManagementVersion: "v2" }
  });
  const create = vi.fn(async (_request: ModelGatewayRequest) => ({
    response: { output: [], output_text: "" }, weightedTokens: 0
  } as ModelGatewayResult));
  await createModelResponse({
    models: { create, isQuotaExceeded: async () => false }, chatGptCodex: false,
    modelType: "claude", modelPayload: { model: "claude" }, promptCacheKey: turn.promptCacheKey,
    prefixItems: turn.promptPrefixItems, tools: turn.responseTools,
    conversationItems: [...windowItems, { role: "user", content: "Task" }, ...tail]
  });
  return create.mock.calls[0][0];
}

describe("window opening prompt", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["content", "timestamp"])("keeps an idle request append-only after note %s changes and the executor restarts", async (change) => {
    const { store, loadNotesSummary } = fixture();
    const original = await buildV2WindowDeveloperItems(store() as RunContextStore, { state, agentName: "main" });
    const before = await request(original);
    loadNotesSummary.mockResolvedValue({
      continuity: change === "content" ? "Updated notes" : "Opening notes",
      index: [{ path: "continuity.md", size: 13, updatedAt: "2026-10-29T13:00:00Z" }]
    });
    const resumed = await buildV2WindowDeveloperItems(store() as RunContextStore, {
      state: { ...state, contextNodeId: "linked-node" }, agentName: "main"
    });
    const conversationItems: ResponseInputItem[] = [...resumed];
    const recordItems = vi.fn(async () => {});
    const execution = {
      maxRunSteps: 800, prepared: { control: { context: { recordItems } } },
      state: { contextManagement: state, dispatchState: { conversationItems, runPersistedItems: [] } }
    } as unknown as AgentExecutionContext;
    await runIdleCompaction(execution, async () => {
      const idleNote = conversationItems.at(-1)!;
      const after = await request(resumed, [idleNote]);
      expect(after.body.input).toEqual([...(before.body.input as ResponseInputItem[]), idleNote]);
      expect(after.body.tools).toEqual(before.body.tools);
      expect(after.body.prompt_cache_key).toBe(before.body.prompt_cache_key);
      expect(after.headers).toEqual(before.headers);
    });
    expect(recordItems).toHaveBeenCalledOnce();
  });

  it("takes a fresh notes snapshot only when a new window opens", async () => {
    const { store, loadNotesSummary } = fixture();
    const original = await buildV2WindowDeveloperItems(store() as RunContextStore, { state, agentName: "main" });
    loadNotesSummary.mockResolvedValue({ continuity: "Fresh notes", index: [] });
    const next = await buildV2WindowDeveloperItems(store() as RunContextStore, {
      state: { ...state, windowId: "window-2", previousWindowId: state.windowId }, agentName: "main"
    });
    expect(next).not.toEqual(original);
    expect(next[0]).toMatchObject({ content: expect.stringContaining("Fresh notes") });
    expect(await buildV2WindowDeveloperItems(store() as RunContextStore, { state, agentName: "main" })).toEqual(original);
  });

  it("does not let live item mutations alter the persisted opening prompt", async () => {
    const { store } = fixture();
    const original = await buildV2WindowDeveloperItems(store() as RunContextStore, { state, agentName: "main" });
    const saved = structuredClone(original);
    Object.assign(original[0], { content: "Changed locally" });
    expect(await buildV2WindowDeveloperItems(store() as RunContextStore, { state, agentName: "main" })).toEqual(saved);
  });
});
