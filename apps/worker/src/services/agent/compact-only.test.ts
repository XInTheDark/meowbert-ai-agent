import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendMessage: vi.fn(),
  emitTaskEvent: vi.fn(),
  recordRunCompletion: vi.fn(),
  setTaskStatusForRun: vi.fn(),
  compactContextNow: vi.fn(),
  resetV2ContextWindow: vi.fn()
}));
const { appendMessage, emitTaskEvent, recordRunCompletion, setTaskStatusForRun, compactContextNow, resetV2ContextWindow } = mocks;

vi.mock("../runtime/events.js", () => ({ emitTaskEvent: mocks.emitTaskEvent }));
vi.mock("../agent-db/index.js", () => ({
  appendMessage: mocks.appendMessage,
  recordRunCompletion: mocks.recordRunCompletion,
  setTaskStatusForRun: mocks.setTaskStatusForRun
}));
vi.mock("../context-compaction/index.js", () => ({
  compactContextNow: mocks.compactContextNow
}));
vi.mock("./context-window.js", () => ({ resetV2ContextWindow: mocks.resetV2ContextWindow }));

import { maybeHandleCompactOnlyRun } from "./compact-only.js";

function buildExecution(restoreStatus?: "awaiting_input" | "succeeded" | "failed" | "cancelled") {
  return {
    job: {
      mode: "compact_only",
      taskId: "task-1",
      runId: "run-1",
      restoreStatus
    },
    manualClearItems: null,
    prepared: {
      runtimeProvider: {},
      runtimeModel: "model",
      snapshot: {
        compaction_backend: "native",
        model_request_timeout_ms: 1,
        platform_model_metadata: {}
      },
      maxContextTokens: 100
    },
    runControl: {
      runAbortSignal: new AbortController().signal
    },
    systemPrompt: "system",
    state: {
      currentLeafMessageId: "leaf-1",
      dispatchState: {
        conversationItems: [],
        runPersistedItems: []
      },
      contextManagement: { version: "v1" }
    }
  } as never;
}

describe("maybeHandleCompactOnlyRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appendMessage.mockResolvedValue("clear-message");
    compactContextNow.mockResolvedValue({
      status: "success",
      usageBefore: 10,
      usageAfter: 5
    });
  });

  it("restores the task status that existed before compaction", async () => {
    await expect(maybeHandleCompactOnlyRun(buildExecution("succeeded"))).resolves.toBe(true);

    expect(setTaskStatusForRun).toHaveBeenCalledWith("task-1", "run-1", "succeeded");
    expect(recordRunCompletion).toHaveBeenCalledWith("run-1", "completed");
  });

  it("keeps the historical awaiting-input fallback for old compaction jobs", async () => {
    await maybeHandleCompactOnlyRun(buildExecution());

    expect(setTaskStatusForRun).toHaveBeenCalledWith("task-1", "run-1", "awaiting_input");
  });

  it("rolls V2 manual compaction into a fresh context window", async () => {
    const execution = buildExecution("succeeded") as any;
    execution.state.contextManagement = {
      version: "v2",
      taskId: "task-1",
      firstWindowId: "window-1",
      windowId: "window-1",
      contextNodeId: "node-1",
      previousWindowId: null,
      branchLeafMessageId: "leaf-1",
      reminderSent: false,
      pendingReset: false,
      recoveryPhase: "normal"
    };

    await expect(maybeHandleCompactOnlyRun(execution)).resolves.toBe(true);

    expect(resetV2ContextWindow).toHaveBeenCalledWith(execution, "manual");
    expect(compactContextNow).not.toHaveBeenCalled();
  });

  it("clears V1 context without calling the compaction model or retaining reasoning", async () => {
    const execution = buildExecution("succeeded") as any;
    execution.job.contextAction = "clear";
    execution.prepared.maxContextTokens = 1000;
    execution.manualClearItems = [
      { role: "user", content: "request before compaction" },
      { role: "user", content: "request" },
      { type: "reasoning", encrypted_content: "secret" },
      { type: "function_call", call_id: "call-1", name: "run_shell", arguments: "{}" }
    ];
    execution.state.dispatchState.conversationItems = [];

    await expect(maybeHandleCompactOnlyRun(execution)).resolves.toBe(true);

    expect(compactContextNow).not.toHaveBeenCalled();
    expect(execution.state.dispatchState.conversationItems).toEqual([
      { role: "user", content: "request before compaction" },
      { role: "user", content: "request" },
      { type: "function_call", call_id: "call-1", name: "run_shell", arguments: "{}" },
      {
        type: "function_call_output",
        call_id: "call-1",
        output: JSON.stringify({ error: "Recovered missing function_call_output from historical task state." })
      },
      expect.objectContaining({ role: "system", content: expect.stringContaining("manual clear") })
    ]);
  });

  it("seeds a fresh V2 window from the prepared visible history", async () => {
    const execution = buildExecution("succeeded") as any;
    execution.job.contextAction = "clear";
    execution.prepared.maxContextTokens = 1000;
    execution.state.contextManagement = { version: "v2" };
    execution.manualClearItems = [
      { role: "user", content: "request" },
      { type: "reasoning", encrypted_content: "secret" },
      { type: "function_call", call_id: "call-1", name: "run_shell", arguments: "{}" },
      { type: "function_call_output", call_id: "call-1", output: "done" }
    ];

    await expect(maybeHandleCompactOnlyRun(execution)).resolves.toBe(true);

    expect(resetV2ContextWindow).toHaveBeenCalledWith(execution, "manual_clear", [
      { role: "user", content: "request" },
      { type: "function_call", call_id: "call-1", name: "run_shell", arguments: "{}" },
      { type: "function_call_output", call_id: "call-1", output: "done" }
    ]);
  });
});
