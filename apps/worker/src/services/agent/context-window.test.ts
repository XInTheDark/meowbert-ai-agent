import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextManagementV2State } from "../context-management-v2/types.js";

const mocks = vi.hoisted(() => ({
  appendMessage: vi.fn(async () => "checkpoint-msg-1"),
  setTaskBranchSelection: vi.fn(async () => {}),
  linkContextNodeToVisibleMessage: vi.fn(async (input: { state: ContextManagementV2State; visibleMessageId: string }) => ({
    ...input.state,
    contextNodeId: "visible-checkpoint-node"
  })),
  buildV2WindowDeveloperItems: vi.fn(async () => [{ role: "developer", content: "window prompt" }]),
  recordContextItems: vi.fn(async () => {}),
  startNewContextWindow: vi.fn(),
  contextWindowGuidance: "window guidance"
}));

vi.mock("../agent-db/index.js", () => ({
  appendMessage: mocks.appendMessage,
  setTaskBranchSelection: mocks.setTaskBranchSelection
}));

vi.mock("../context-management-v2/index.js", () => ({
  buildV2WindowDeveloperItems: mocks.buildV2WindowDeveloperItems,
  CONTEXT_WINDOW_GUIDANCE: mocks.contextWindowGuidance,
  linkContextNodeToVisibleMessage: mocks.linkContextNodeToVisibleMessage,
  recordContextItems: mocks.recordContextItems,
  startNewContextWindow: mocks.startNewContextWindow
}));

import { resetV2ContextWindow, selectContextOverflowRecoveryItems } from "./context-window.js";

const currentState: ContextManagementV2State = {
  version: "v2",
  taskId: "task-1",
  firstWindowId: "window-1",
  windowId: "window-1",
  contextNodeId: "node-1",
  previousWindowId: null,
  branchLeafMessageId: "message-1",
  reminderSent: true,
  pendingReset: true,
  recoveryPhase: "needs_reset"
};

const nextState: ContextManagementV2State = {
  ...currentState,
  windowId: "window-2",
  contextNodeId: "node-2",
  previousWindowId: "window-1",
  reminderSent: false,
  pendingReset: false,
  recoveryPhase: "normal"
};

describe("resetV2ContextWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startNewContextWindow.mockResolvedValue(nextState);
  });

  it("clears usage and flushes persisted tool activity to a checkpoint message after opening the next window", async () => {
    const execution = {
      job: { taskId: "task-1", selectionUserId: "user-1" },
      state: {
        contextManagement: currentState,
        currentLeafMessageId: "message-2",
        dispatchState: {
          conversationItems: [{ role: "user", content: "old" }],
          runPersistedItems: [{ role: "assistant", content: "old" }],
          contextUsage: { usedTokens: 120, maxContextTokens: 100, percent: 100 },
          pendingContextV2Reset: true
        },
        lastActualContextUsage: { inputTokens: 120, estimatedInputTokens: 120 },
        hasActualContextUsage: true
      },
      prepared: { runtimeAgentId: "main" }
    } as never;

    await resetV2ContextWindow(execution, "manual");

    expect(mocks.appendMessage).toHaveBeenCalledWith(
      "task-1",
      "system",
      {
        kind: "context_checkpoint",
        action: "rollover",
        reason: "manual",
        checkpoint: "Context window rollover (manual). Conversation items archived to context history.",
        response_items: [{ role: "assistant", content: "old" }]
      },
      {
        parentMessageId: "message-2"
      }
    );
    expect(mocks.setTaskBranchSelection).toHaveBeenCalledWith("task-1", "user-1", "checkpoint-msg-1");
    expect(mocks.startNewContextWindow).toHaveBeenCalledWith({
      state: currentState,
      branchLeafMessageId: "checkpoint-msg-1",
      reason: "manual"
    });
    expect(mocks.linkContextNodeToVisibleMessage).toHaveBeenCalledWith({
      state: nextState,
      visibleMessageId: "checkpoint-msg-1"
    });
    expect(execution.state.currentLeafMessageId).toBe("checkpoint-msg-1");
    expect(execution.state.contextManagement).toBe(nextState);
    expect(mocks.buildV2WindowDeveloperItems).toHaveBeenCalledWith({
      state: nextState,
      agentName: "main"
    });
    expect(execution.state.dispatchState.contextUsage).toBeNull();
    expect(execution.state.lastActualContextUsage).toBeNull();
    expect(execution.state.hasActualContextUsage).toBe(false);
    expect(execution.state.dispatchState.pendingContextV2Reset).toBe(false);
    expect(execution.state.dispatchState.runPersistedItems).toEqual([]);
    expect(execution.state.dispatchState.conversationItems).toEqual([
      { role: "developer", content: "window prompt" },
      { role: "developer", content: "window guidance" }
    ]);
  });

  it("seeds the next window with bounded recovery items and records them", async () => {
    const longRequest = `request ${"x".repeat(20_000)}\n[id: 123e4567-e89b-12d3-a456-426614174000]`;
    const seedItems = [{ role: "user", content: longRequest }] as const;
    const execution = {
      job: { taskId: "task-1" },
      state: {
        contextManagement: currentState,
        currentLeafMessageId: "message-2",
        dispatchState: {
          conversationItems: [{ role: "user", content: "old" }],
          runPersistedItems: [],
          contextUsage: null,
          pendingContextV2Reset: false
        },
        lastActualContextUsage: null,
        hasActualContextUsage: false
      },
      prepared: { runtimeAgentId: "main" }
    } as never;

    const recoveryItems = selectContextOverflowRecoveryItems(seedItems as never);
    await resetV2ContextWindow(execution, "provider_overflow", recoveryItems);

    expect(execution.state.dispatchState.conversationItems).toHaveLength(3);
    expect(execution.state.dispatchState.conversationItems[2]).toEqual({
      role: "user",
      content: expect.stringContaining("[recovery excerpt truncated; use context history tools for the full request]")
    });
    expect((execution.state.dispatchState.conversationItems[2] as { content: string }).content).toContain(
      "[id: 123e4567-e89b-12d3-a456-426614174000]"
    );
    expect(mocks.recordContextItems).toHaveBeenCalledWith(nextState, recoveryItems);
  });
});
