import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAgentTurnRequest } from "@meowbert/run-executor/agent/turn-request";

vi.mock("@meowbert/shared", async () => {
  const actual = await vi.importActual<typeof import("@meowbert/shared")>("@meowbert/shared");
  return {
    ...actual,
    getSandboxNetworkEnabled: vi.fn(() => false)
  };
});

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn()
}));

vi.mock("../agent-db/index.js", () => ({
  appendMessage: vi.fn()
}));

vi.mock("../computer/computer-use.js", () => ({
  getDesktopComputerPresence: vi.fn()
}));

vi.mock("@meowbert/run-executor/computer/desktop-computer-status", () => ({
  buildDesktopComputerUnavailableMessage: vi.fn(() => "desktop unavailable")
}));

vi.mock("@meowbert/run-executor/context-compaction/index", () => ({
  compactContextNow: vi.fn(async () => ({ status: "compacted" })),
  emitActualContextUsage: vi.fn(),
  estimateContextTokens: vi.fn(() => 0),
  maybeAutoCompactContext: vi.fn(async () => ({ status: "skipped" })),
  recoverContextAfterContextWindowError: vi.fn(async () => ({ status: "compacted" }))
}));

vi.mock("@meowbert/run-executor/context-management/index", () => ({
  checkpointAndTrimContext: vi.fn(),
  persistContextCheckpoint: vi.fn()
}));

// The loop's view of a model turn: the response, with the run's control handle left out of the call.
const modelTurn = vi.hoisted(() => vi.fn());
vi.mock("@meowbert/run-executor/agent/model", () => ({
  createModelResponseWithRetry: vi.fn(async (_control: unknown, ...args: unknown[]) => ({
    response: await modelTurn(...args),
    weightedTokens: 0
  }))
}));

vi.mock("@meowbert/run-executor/agent/model-request-recovery", () => ({
  persistModelRequestRecovery: vi.fn()
}));

vi.mock("@meowbert/run-executor/agent/context-window", () => ({
  resetV2ContextWindow: vi.fn(),
  selectContextOverflowRecoveryItems: vi.fn((items: Array<{ role?: string; content?: unknown }>) => {
    const latestUserItem = [...items].reverse().find((item) =>
      item.role === "user"
      && typeof item.content === "string"
      && !item.content.startsWith("[System:")
    );
    return latestUserItem ? [latestUserItem] : [];
  })
}));

vi.mock("@meowbert/run-executor/agent-tool-dispatch/index", () => ({
  dispatchResponseOutput: vi.fn()
}));

vi.mock("@meowbert/run-executor/agent/turn-request", () => ({
  buildAgentTurnRequest: vi.fn(() => ({
    responseTools: [],
    codeModeTools: [],
    promptPrefixItems: [],
    promptPrefixHash: "prefix-hash",
    promptRevision: "prompt-revision",
    promptCacheKey: "prompt-cache-key"
  }))
}));

vi.mock("@meowbert/run-executor/agent/prompt-envelope", () => ({
  appendPromptEnvelopeDelta: vi.fn(),
  promptEnvelopeToPrefixItems: vi.fn(() => []),
  sealPromptEnvelope: vi.fn()
}));

vi.mock("@meowbert/run-executor/agent/queued-prompt-deltas", () => ({
  appendQueuedPromptDeltas: vi.fn()
}));

vi.mock("../queued-messages/inbox.js", () => ({
  appendQueuedUserMessages: vi.fn()
}));

vi.mock("../task-workflows/service.js", () => ({
  loadLongHorizonBudgetTelemetry: vi.fn(),
  startLongHorizonTask: vi.fn(),
  submitLongHorizonResponse: vi.fn(),
  submitLongHorizonReview: vi.fn()
}));

vi.mock("@meowbert/run-executor/tasks/recurring-run-utils", () => ({
  buildTimedRunFinalizationMessage: vi.fn(() => "timed finalization")
}));

import { persistModelRequestRecovery } from "@meowbert/run-executor/agent/model-request-recovery";
import { dispatchResponseOutput } from "@meowbert/run-executor/agent-tool-dispatch/index";
import {
  compactContextNow,
  emitActualContextUsage,
  recoverContextAfterContextWindowError
} from "@meowbert/run-executor/context-compaction/index";
import { persistContextCheckpoint } from "@meowbert/run-executor/context-management/index";
import { createFakeRunControl } from "../run-host/test-run-environment.test-fixtures.js";
import { runAgentStepLoop } from "@meowbert/run-executor/agent/loop";
import { resetV2ContextWindow } from "@meowbert/run-executor/agent/context-window";
import { cloudRunFeatures } from "../run-host/cloud-run-features.js";

function createExecutionContext() {
  const abortController = new AbortController();

  return {
    job: {
      taskId: "task-1",
      runId: "run-1",
      mode: "default",
      triggerSource: "web",
      selectionUserId: null
    },
    prepared: {
      settings: {},
      features: cloudRunFeatures,
      control: createFakeRunControl(),
      models: { create: vi.fn(), isQuotaExceeded: vi.fn(async () => false) },
      chatGptCodex: false,
      runtimeProviderKind: "platform",
      runtimeProviderBaseUrl: "https://example.com/v1",
      runtimeModel: "gpt-test",
      runtimeCompatibilityModes: [],
      runtimeModelPayload: {},
      maxContextTokens: 128_000,
      runShellMaxTimeoutSeconds: 60,
      thoughtPersistenceEnabled: true,
      runToolOptions: {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: []
      },
      activeSkillTools: [],
      liveSyncFiles: [],
      hasGitHubAppConnection: false,
      githubInstallationAccess: null,
      networkRequestLoggingEnabled: false,
      taskDir: "/tmp/task-1",
      envRoot: "/tmp/env-1",
      workspaceRoot: "/tmp/ws-1",
      sandbox: null,
      shellEnvOverrides: {},
      baseEnvironmentJsonPayload: {},
      snapshot: {
        thought_persistence_enabled: true,
        model_request_timeout_ms: 30_000,
        shell_tool_max_timeout_ms: 30_000,
        image_detail: "auto",
        compaction_backend: "summary",
        context_management_tools_enabled: false,
        platform_model_metadata: {},
        enable_prompt_caching: true,
        task: {
          initiator_user_id: "user-1",
          allow_waiting: true,
          workspace_id: "workspace-1",
          environment_id: "environment-1",
          source: "web",
          connector_context_id: null,
          default_timezone: "UTC"
        }
      },
      skillsRootDir: null,
      resolvedRunActorIsSuperAdmin: false,
      activeMcpConnections: new Map(),
      enableSkillById: vi.fn(),
      refreshGitHubToken: vi.fn(),
      runActorUserId: null,
      cancellationMonitor: {
        signal: abortController.signal,
        assertNotCancelled: vi.fn(async () => {})
      }
    },
    debugLogger: {
      log: vi.fn(async () => {}),
      stage: vi.fn()
    },
    taskInputDir: "/tmp/task-1/inputs",
    scheduleInfo: null,
    allowScheduleTools: false,
    loadedToolGroups: new Set<string>(),
    enableSkillById: vi.fn(),
    onDemandCapabilities: [],
    allowSubtaskTools: false,
    allowStopTask: false,
    maxRunSteps: 4,
    recurringStateFilePath: null,
    workflow: {
      workflowContext: null,
      workflowPromptContext: null,
      allowWorkflowFinalResponse: false,
      allowWorkflowStartLongHorizon: false,
      allowWorkflowRequestClarification: false,
      allowWorkflowSubmitResponse: false,
      allowWorkflowSubmitReview: false,
    },
    systemPrompt: "system prompt",
    promptEnvelope: {},
    runTiming: {
      isTimedInfiniteRun: false,
      runDeadlineAtMs: null,
      runTimedOut: false,
      reachedMaxRunSteps: false,
      timedRunFinalizing: false,
      timedRunFinalizationPromptInjected: false,
      runTimeLimitController: null,
      runTimeLimitTimer: null,
      runAbortSignal: abortController.signal
    },
    state: {
      currentLeafMessageId: null,
      dispatchState: {
        conversationItems: [],
        runPersistedItems: [],
        commandStep: 0
      },
      hasActualContextUsage: false,
      finalResponseFromTool: null,
      waitRequest: null,
      stopRequest: null,
      workflowPauseRequest: null,
      workflowAssistantPauseResponse: null,
      notificationRequested: true
    },
    assertRunNotAborted: vi.fn(async () => {}),
    injectTimedRunFinalizationPrompt: vi.fn()
  } as any;
}

function createExpiredTimedExecutionContext() {
  const execution = createExecutionContext();
  const deadlineController = new AbortController();
  deadlineController.abort(new Error("RUN_TIME_LIMIT_REACHED"));
  execution.job.mode = "infinite_auto";
  execution.runTiming.isTimedInfiniteRun = true;
  execution.runTiming.runTimeLimitController = deadlineController;
  execution.runTiming.runAbortSignal = deadlineController.signal;
  execution.assertRunNotAborted.mockRejectedValue(new Error("RUN_TIME_LIMIT_REACHED"));
  return execution;
}

describe("runAgentStepLoop", () => {
  const mockedCreateModelResponseWithRetry = modelTurn;
  const mockedDispatchResponseOutput = vi.mocked(dispatchResponseOutput);
  const mockedRecoverContextAfterContextWindowError = vi.mocked(recoverContextAfterContextWindowError);
  const mockedCompactContextNow = vi.mocked(compactContextNow);
  const mockedEmitActualContextUsage = vi.mocked(emitActualContextUsage);
  const mockedPersistContextCheckpoint = vi.mocked(persistContextCheckpoint);
  const mockedResetV2ContextWindow = vi.mocked(resetV2ContextWindow);
  const mockedPersistModelRequestRecovery = vi.mocked(persistModelRequestRecovery);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delivers the timed wrap-up response despite the expired run deadline", async () => {
    const execution = createExpiredTimedExecutionContext();
    const finalResponse = { response: "Completed work before the deadline.", notify: true, partial: false };
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({ output: [], output_text: "" } as never);
    mockedDispatchResponseOutput.mockImplementationOnce(async (_output, ctx) => {
      ctx.cancellationSignal?.throwIfAborted();
      await ctx.assertNotCancelled();
      return { sawToolCall: true, sawFunctionToolCall: true, finalResponse, waitRequest: null, stopRequest: null, workflowPause: null };
    });

    await expect(runAgentStepLoop(execution)).resolves.toBeUndefined();

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(1);
    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledWith("task-1", expect.objectContaining({
      abortSignal: execution.prepared.cancellationMonitor.signal
    }), expect.any(Function));
    expect(execution.assertRunNotAborted).toHaveBeenCalledTimes(1);
    expect(execution.injectTimedRunFinalizationPrompt).toHaveBeenCalledTimes(1);
    expect(execution.runTiming.runTimedOut).toBe(true);
    expect(execution.runTiming.reachedMaxRunSteps).toBe(false);
    expect(execution.state.finalResponseFromTool).toEqual(finalResponse);
  });

  it("does not cap turns to an output budget, so reasoning cannot starve the action", async () => {
    const execution = createExecutionContext();
    mockedCreateModelResponseWithRetry
      .mockResolvedValueOnce({
        output: [{ type: "reasoning" }],
        output_text: "",
        incomplete_details: { reason: "max_output_tokens" }
      } as never)
      .mockResolvedValueOnce({ output: [], output_text: "" } as never);
    mockedDispatchResponseOutput
      .mockResolvedValueOnce({
        sawToolCall: false,
        sawFunctionToolCall: false,
        finalResponse: null,
        waitRequest: null,
        stopRequest: null,
        workflowPause: null
      })
      .mockResolvedValueOnce({
        sawToolCall: true,
        sawFunctionToolCall: true,
        finalResponse: { response: "done", notify: true, partial: false },
        waitRequest: null,
        stopRequest: null,
        workflowPause: null
      });

    await runAgentStepLoop(execution as never);

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(2);
    expect(mockedCreateModelResponseWithRetry.mock.calls[0][1]).not.toHaveProperty("maxOutputTokens");
    expect(execution.state.dispatchState.conversationItems).toContainEqual({
      role: "user",
      content: expect.stringContaining("hit the output token limit")
    });
  });

  it("finishes with the timeout message if the wrap-up turn fails", async () => {
    const execution = createExpiredTimedExecutionContext();
    mockedCreateModelResponseWithRetry.mockRejectedValueOnce(new Error("Provider unavailable"));

    await expect(runAgentStepLoop(execution)).resolves.toBeUndefined();

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(1);
    expect(execution.runTiming.reachedMaxRunSteps).toBe(false);
    expect(execution.state.finalResponseFromTool).toEqual({
      response: "Timed task reached its time limit and could not produce a final response before stopping.",
      notify: true
    });
  });

  it("preserves explicit cancellation during timed wrap-up", async () => {
    const execution = createExpiredTimedExecutionContext();
    execution.prepared.cancellationMonitor.assertNotCancelled.mockRejectedValueOnce(new Error("TASK_CANCELLED"));

    await expect(runAgentStepLoop(execution)).rejects.toThrow("TASK_CANCELLED");

    expect(mockedCreateModelResponseWithRetry).not.toHaveBeenCalled();
    expect(execution.state.finalResponseFromTool).toBeNull();
  });

  it("propagates ordinary run errors to the existing retry handler", async () => {
    const execution = createExecutionContext();
    mockedCreateModelResponseWithRetry.mockRejectedValueOnce(new Error("Provider unavailable"));

    await expect(runAgentStepLoop(execution)).rejects.toThrow("Provider unavailable");

    expect(execution.runTiming.runTimedOut).toBe(false);
    expect(execution.state.finalResponseFromTool).toBeNull();
  });

  it.each([
    { label: "workspace experiment on", workspace: true, metadata: {}, codeMode: true },
    { label: "model opted out", workspace: true, metadata: { "gpt-test": { code_mode: false } }, codeMode: false },
    { label: "workspace experiment off", workspace: false, metadata: {}, codeMode: false }
  ])("requests code mode only when it applies: $label", async ({ workspace, metadata, codeMode }) => {
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({ output: [], output_text: "", usage: undefined } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: true,
      sawFunctionToolCall: true,
      finalResponse: { response: "done", notify: true, partial: false },
      waitRequest: null,
      stopRequest: null,
      workflowPause: null
    });
    const execution = createExecutionContext();
    Object.assign(execution.prepared.snapshot, { code_mode_enabled: workspace, platform_model_metadata: metadata });

    await runAgentStepLoop(execution as never);

    expect(buildAgentTurnRequest).toHaveBeenLastCalledWith(expect.objectContaining({ codeMode }));
  });

  it("continues to the next reasoning step after a non-terminal tool call", async () => {
    mockedCreateModelResponseWithRetry
      .mockResolvedValueOnce({
        output: [],
        output_text: "",
        usage: undefined
      } as never)
      .mockResolvedValueOnce({
        output: [],
        output_text: "",
        usage: undefined
      } as never);

    mockedDispatchResponseOutput
      .mockResolvedValueOnce({
        sawToolCall: true,
        sawFunctionToolCall: true,
        finalResponse: null,
        waitRequest: null,
        stopRequest: null,
        workflowPause: null
      })
      .mockResolvedValueOnce({
        sawToolCall: true,
        sawFunctionToolCall: true,
        finalResponse: {
          response: "done",
          notify: true,
          partial: false
        },
        waitRequest: null,
        stopRequest: null,
        workflowPause: null
      });

    const execution = createExecutionContext();

    await runAgentStepLoop(execution as never);

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(2);
    expect(buildAgentTurnRequest).toHaveBeenCalledWith(expect.objectContaining({
      availability: expect.objectContaining({ allowWaitTool: true, allowFinalResponse: true })
    }));
    expect(execution.runTiming.reachedMaxRunSteps).toBe(false);
    expect(execution.state.finalResponseFromTool).toEqual({
      response: "done",
      notify: true,
      partial: false
    });
  });

  it.each([
    { label: "a text-only progress update", sawToolCall: false, text: "I'm now checking the report cells against the rubric." },
    { label: "a text-only answer", sawToolCall: false, text: "Done." },
    { label: "text after a hosted tool", sawToolCall: true, text: "I found the sources and will now review them." }
  ])("continues after $label until final_response is called", async ({ sawToolCall, text }) => {
    mockedCreateModelResponseWithRetry
      .mockResolvedValueOnce({ output: [], output_text: text, usage: undefined } as never)
      .mockResolvedValueOnce({ output: [], output_text: "", usage: undefined } as never);
    mockedDispatchResponseOutput
      .mockResolvedValueOnce({
        sawToolCall,
        sawFunctionToolCall: false,
        finalResponse: null,
        waitRequest: null,
        stopRequest: null,
        workflowPause: null
      })
      .mockResolvedValueOnce({
        sawToolCall: true,
        sawFunctionToolCall: true,
        finalResponse: { response: "Review complete.", notify: false, partial: false },
        waitRequest: null,
        stopRequest: null,
        workflowPause: null
      });
    const execution = createExecutionContext();

    await runAgentStepLoop(execution as never);

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(2);
    expect(execution.state.finalResponseFromTool).toEqual({
      response: "Review complete.", notify: false, partial: false
    });
    expect(execution.runTiming.reachedMaxRunSteps).toBe(false);
    expect(execution.state.dispatchState.conversationItems).toContainEqual({
      role: "user",
      content: "[System: Continue working with tools. When the task is complete, call final_response explicitly; plain text does not finish the run.]"
    });
  });

  it("keeps repeated text-only turns bounded by the existing step limit", async () => {
    mockedCreateModelResponseWithRetry.mockResolvedValue({
      output: [], output_text: "I'm still reviewing the notebook.", usage: undefined
    } as never);
    mockedDispatchResponseOutput.mockResolvedValue({
      sawToolCall: false,
      sawFunctionToolCall: false,
      finalResponse: null,
      waitRequest: null,
      stopRequest: null,
      workflowPause: null
    });
    const execution = createExecutionContext();
    execution.maxRunSteps = 3;

    await runAgentStepLoop(execution as never);

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(3);
    expect(execution.runTiming.reachedMaxRunSteps).toBe(true);
    expect(execution.state.finalResponseFromTool).toBeNull();
    expect(execution.state.waitRequest).toBeNull();
    expect(execution.state.stopRequest).toBeNull();
  });

  it("runs checkpoint compaction through the existing compactContextNow path", async () => {
    mockedCreateModelResponseWithRetry
      .mockResolvedValueOnce({ output: [], output_text: "", usage: undefined } as never)
      .mockResolvedValueOnce({ output: [], output_text: "", usage: undefined } as never);
    mockedDispatchResponseOutput
      .mockImplementationOnce(async (_output, _ctx, state) => {
        state.pendingContextManagementAction = {
          kind: "compact",
          checkpoint: "Detailed checkpoint",
          callId: "call-compact"
        };
        return {
          sawToolCall: true,
          sawFunctionToolCall: true,
          finalResponse: null,
          waitRequest: null,
          stopRequest: null,
          workflowPause: null
        };
      })
      .mockResolvedValueOnce({
        sawToolCall: true,
        sawFunctionToolCall: true,
        finalResponse: { response: "done", notify: true, partial: false },
        waitRequest: null,
        stopRequest: null,
        workflowPause: null
      });
    const execution = createExecutionContext();
    execution.prepared.snapshot.context_management_tools_enabled = true;

    await runAgentStepLoop(execution as never);

    expect(mockedCompactContextNow).toHaveBeenCalledOnce();
    expect(mockedCompactContextNow).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      compactionBackend: "summary",
      conversationItems: execution.state.dispatchState.conversationItems,
      runPersistedItems: execution.state.dispatchState.runPersistedItems
    }));
    expect(mockedPersistContextCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      action: "compact",
      checkpoint: "Detailed checkpoint"
    }));
  });

  it("marks the run as reaching the max step limit when every step continues", async () => {
    mockedCreateModelResponseWithRetry.mockResolvedValue({
      output: [],
      output_text: "",
      usage: undefined
    } as never);
    mockedDispatchResponseOutput.mockResolvedValue({
      sawToolCall: true,
      sawFunctionToolCall: true,
      finalResponse: null,
      waitRequest: null,
      stopRequest: null,
      workflowPause: null
    });

    const execution = createExecutionContext();
    execution.maxRunSteps = 3;

    await runAgentStepLoop(execution as never);

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(3);
    expect(execution.runTiming.reachedMaxRunSteps).toBe(true);
    expect(execution.debugLogger.log).toHaveBeenCalledWith(
      "Run exhausted its reasoning step budget without a terminal tool call.",
      expect.objectContaining({
        stage: "run.max_steps",
        phase: "warn",
        maxRunSteps: 3
      })
    );
  });

  it("keeps going after an empty no-action model turn and logs the anomaly", async () => {
    mockedCreateModelResponseWithRetry
      .mockResolvedValueOnce({
        output: [],
        output_text: "",
        usage: undefined
      } as never)
      .mockResolvedValueOnce({
        output: [],
        output_text: "",
        usage: undefined
      } as never);
    mockedDispatchResponseOutput
      .mockResolvedValueOnce({
        sawToolCall: false,
        sawFunctionToolCall: false,
        finalResponse: null,
        waitRequest: null,
        stopRequest: null,
        workflowPause: null
      })
      .mockResolvedValueOnce({
        sawToolCall: true,
        sawFunctionToolCall: true,
        finalResponse: { response: "Done.", notify: true },
        waitRequest: null,
        stopRequest: null,
        workflowPause: null
      });

    const execution = createExecutionContext();

    await runAgentStepLoop(execution as never);

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(2);
    expect(execution.state.finalResponseFromTool).toEqual({
      response: "Done.",
      notify: true
    });
    expect(execution.debugLogger.log).toHaveBeenCalledWith(
      "Model turn finished without any actionable output.",
      expect.objectContaining({
        stage: "run.turn.no_action",
        phase: "warn",
        step: 0,
        outputItemCount: 0
      })
    );
    expect(execution.state.dispatchState.conversationItems).toContainEqual({
      role: "user",
      content: "[System: Your previous turn produced no answer text and no tool calls. Call final_response() if you are done, use wait() for a bounded delay or shell-session condition, or keep working with tools.]"
    });
  });

  it("passes prompt cache TTL when prompt caching is enabled", async () => {
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({
      output: [],
      output_text: "",
      usage: undefined
    } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: true,
      sawFunctionToolCall: true,
      finalResponse: {
        response: "done",
        notify: true,
        partial: false
      },
      waitRequest: null,
      stopRequest: null,
      workflowPause: null
    });

    const execution = createExecutionContext();
    execution.prepared.snapshot.enable_prompt_caching = true;

    await runAgentStepLoop(execution as never);

    const request = mockedCreateModelResponseWithRetry.mock.calls[0]?.[1] as {
      promptCacheTtl?: string;
    };
    expect(request.promptCacheTtl).toBe("30m");
  });

  it("reports the context usage of each model turn", async () => {
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({
      output: [],
      output_text: "",
      usage: {
        input_tokens: 120,
        output_tokens: 30,
        input_tokens_details: {
          cached_tokens: 20,
          cache_write_tokens: 30
        },
        output_tokens_details: {
          reasoning_tokens: 10
        }
      }
    } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: true,
      sawFunctionToolCall: true,
      finalResponse: { response: "Done.", notify: true },
      waitRequest: null,
      stopRequest: null,
      workflowPause: null
    });

    const execution = createExecutionContext();

    await runAgentStepLoop(execution as never);

    expect(execution.state.dispatchState.contextUsage).toEqual({
      usedTokens: 120,
      maxContextTokens: 128_000,
      percent: 0
    });
  });

  it("replaces the V2 window after reconstructing a model request", async () => {
    const execution = createExecutionContext();
    execution.prepared.snapshot.messages = [];
    execution.state.contextManagement = {
      version: "v2",
      taskId: "task-1",
      firstWindowId: "window-1",
      windowId: "window-1",
      contextNodeId: "node-1",
      previousWindowId: null,
      branchLeafMessageId: null,
      reminderSent: false,
      pendingReset: false,
      recoveryPhase: "normal"
    };
    execution.state.dispatchState.conversationItems = [
      { role: "developer", content: "window prompt" },
      { role: "developer", content: "window guidance" },
      { role: "user", content: "request" },
      { type: "function_call", call_id: "call-1", name: "run_shell", arguments: "{}" }
    ];
    mockedPersistModelRequestRecovery.mockImplementationOnce(async (input) => {
      input.conversationItems.push({ type: "function_call_output", call_id: "call-1", output: "stored result" });
      return true;
    });
    mockedCreateModelResponseWithRetry.mockImplementationOnce(async (_taskId, input) => {
      expect(await input.onConsecutiveErrorRecovery?.("No tool output found for function call call-1")).toBe(true);
      return { output: [], output_text: "" } as never;
    });
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: true,
      sawFunctionToolCall: true,
      finalResponse: { response: "Done.", notify: true },
      waitRequest: null,
      stopRequest: null,
      workflowPause: null
    });

    await runAgentStepLoop(execution as never);

    expect(mockedPersistModelRequestRecovery).toHaveBeenCalledWith(expect.objectContaining({ historicalMessages: [] }));
    expect(mockedResetV2ContextWindow).toHaveBeenCalledWith(execution, "model_request_recovery", [
      { role: "user", content: "request" },
      { type: "function_call", call_id: "call-1", name: "run_shell", arguments: "{}" },
      { type: "function_call_output", call_id: "call-1", output: "stored result" }
    ]);
  });

  it("emits actual context usage for v2 model turns", async () => {
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({
      output: [],
      output_text: "",
      usage: {
        input_tokens: 120,
        input_tokens_details: {
          cached_tokens: 20
        }
      }
    } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: true,
      sawFunctionToolCall: true,
      finalResponse: { response: "Done.", notify: true },
      waitRequest: null,
      stopRequest: null,
      workflowPause: null
    });

    const execution = createExecutionContext();
    execution.state.contextManagement = {
      version: "v2",
      taskId: "task-1",
      firstWindowId: "window-1",
      windowId: "window-1",
      contextNodeId: "node-1",
      previousWindowId: null,
      branchLeafMessageId: null,
      reminderSent: false,
      pendingReset: false,
      recoveryPhase: "normal"
    };

    await runAgentStepLoop(execution as never);

    expect(mockedEmitActualContextUsage).toHaveBeenCalledWith({
      control: execution.prepared.control,
      step: 0,
      maxContextTokens: 128_000,
      inputTokens: 120,
      cachedTokens: 20,
      prefixHash: "prefix-hash",
      promptRevision: "prompt-revision",
      request: { model: "gpt-test", startedAt: expect.any(String) }
    });
  });

  it("gives V2 checkpoint requests real model turns before opening the next window", async () => {
    const execution = createExecutionContext();
    execution.maxRunSteps = 8;
    execution.state.contextManagement = {
      version: "v2", taskId: "task-1", firstWindowId: "window-1", windowId: "window-1",
      contextNodeId: "node-1", previousWindowId: null, branchLeafMessageId: null,
      reminderSent: false, fallbackSent: false, pendingReset: false, recoveryPhase: "normal"
    };
    const store = execution.prepared.control.context;
    let continuity = "";
    store.writeNote.mockImplementation(async (_state, input) => {
      continuity = input.text;
      return { updated: true };
    });
    store.loadNotesSummary.mockImplementation(async () => ({ continuity, index: [] }));
    store.startNewWindow.mockResolvedValue({
      firstWindowId: "window-1", windowId: "window-2",
      contextNodeId: "node-2", previousWindowId: "window-1"
    });
    store.linkVisibleMessage.mockResolvedValue("node-2");
    const actualDispatch = await vi.importActual<typeof import("@meowbert/run-executor/agent-tool-dispatch/index")>(
      "@meowbert/run-executor/agent-tool-dispatch/index"
    );
    const actualWindow = await vi.importActual<typeof import("@meowbert/run-executor/agent/context-window")>(
      "@meowbert/run-executor/agent/context-window"
    );
    mockedResetV2ContextWindow.mockImplementationOnce(actualWindow.resetV2ContextWindow);
    const turns = [
      { name: "get_context_remaining", total: 109_056, args: {} },
      { name: "get_context_remaining", total: 115_200, args: {} },
      { name: "notes_write_file", total: 115_800, args: { path: "notes/continuity.md", text: "Saved goal and next steps." } },
      { name: "new_context", total: 116_000, args: {} },
      { name: "final_response", total: 1_000, args: { response: "Done.", notify: true } }
    ];
    for (const [index, turn] of turns.entries()) {
      mockedCreateModelResponseWithRetry.mockImplementationOnce(async (_taskId, input) => {
        const prompts = input.conversationItems
          .filter((item: { role?: string }) => item.role === "developer")
          .map((item: { content: string }) => item.content);
        if (index === 1) expect(prompts.some((text: string) => text.startsWith("<context_window_reminder>"))).toBe(true);
        if (index === 2) expect(prompts.some((text: string) => text.includes("The current context window is exhausted."))).toBe(true);
        if (index < 4) expect(store.startNewWindow).not.toHaveBeenCalled();
        if (index === 4) {
          expect(prompts.some((text: string) => text.includes(continuity))).toBe(true);
          expect(input.conversationItems.some((item: { type?: string }) => item.type === "function_call")).toBe(false);
        }
        return {
          output: [{ type: "function_call", call_id: `call-${index}`, name: turn.name, arguments: JSON.stringify(turn.args) }],
          output_text: "", usage: { input_tokens: turn.total - 100, output_tokens: 100, total_tokens: turn.total }
        } as never;
      });
      mockedDispatchResponseOutput.mockImplementationOnce(actualDispatch.dispatchResponseOutput);
    }

    await runAgentStepLoop(execution);

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(5);
    expect(store.writeNote).toHaveBeenCalledWith(expect.objectContaining({ windowId: "window-1" }), {
      path: "notes/continuity.md", text: "Saved goal and next steps.", append: false
    });
    expect(mockedResetV2ContextWindow).toHaveBeenCalledExactlyOnceWith(execution, "manual");
    expect(execution.state.contextManagement).toMatchObject({ windowId: "window-2", reminderSent: false, fallbackSent: false });
    expect(execution.state.finalResponseFromTool).toMatchObject({ response: "Done." });
  });

  it("stops with the usage-limit message when the run's quota is used up", async () => {
    const execution = createExecutionContext();
    execution.prepared.models.isQuotaExceeded.mockResolvedValueOnce(true);

    await runAgentStepLoop(execution as never);

    expect(mockedCreateModelResponseWithRetry).not.toHaveBeenCalled();
    expect(execution.state.finalResponseFromTool).toEqual({
      response: expect.stringContaining("Subscription usage limit reached"),
      notify: true
    });
  });

  it("omits prompt cache TTL when prompt caching is disabled", async () => {
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({
      output: [],
      output_text: "",
      usage: undefined
    } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: true,
      sawFunctionToolCall: true,
      finalResponse: {
        response: "done",
        notify: true,
        partial: false
      },
      waitRequest: null,
      stopRequest: null,
      workflowPause: null
    });

    const execution = createExecutionContext();
    execution.prepared.snapshot.enable_prompt_caching = false;

    await runAgentStepLoop(execution as never);

    const request = mockedCreateModelResponseWithRetry.mock.calls[0]?.[1] as {
      promptCacheTtl?: string;
    };
    expect("promptCacheTtl" in request).toBe(false);
    expect(request.promptCacheTtl).toBeUndefined();
  });

  it("compacts context and retries once when the model rejects an oversized turn", async () => {
    mockedCreateModelResponseWithRetry
      .mockRejectedValueOnce(new Error("Your input exceeds the context window of this model. Please adjust your input and try again."))
      .mockResolvedValueOnce({
        output: [],
        output_text: "",
        usage: undefined
      } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: true,
      sawFunctionToolCall: true,
      finalResponse: { response: "Recovered.", notify: true },
      waitRequest: null,
      stopRequest: null,
      workflowPause: null
    });

    const execution = createExecutionContext();
    execution.state.dispatchState.conversationItems = [
      { role: "user", content: "large history" }
    ];

    await runAgentStepLoop(execution as never);

    expect(mockedRecoverContextAfterContextWindowError).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      step: 0,
      model: "gpt-test",
      conversationItems: execution.state.dispatchState.conversationItems,
      runPersistedItems: execution.state.dispatchState.runPersistedItems,
      reason: "Your input exceeds the context window of this model. Please adjust your input and try again."
    }));
    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(2);
    expect(execution.state.finalResponseFromTool).toEqual({
      response: "Recovered.",
      notify: true
    });
  });

  it("rolls over v2 context and retries with only the latest user request", async () => {
    mockedCreateModelResponseWithRetry
      .mockRejectedValueOnce(new Error("Your input exceeds the context window of this model."))
      .mockResolvedValueOnce({
        output: [],
        output_text: "",
        usage: undefined
      } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: true,
      sawFunctionToolCall: true,
      finalResponse: { response: "Recovered.", notify: true },
      waitRequest: null,
      stopRequest: null,
      workflowPause: null
    });

    const execution = createExecutionContext();
    execution.state.contextManagement = {
      version: "v2",
      taskId: "task-1",
      firstWindowId: "window-1",
      windowId: "window-1",
      contextNodeId: "node-1",
      previousWindowId: null,
      branchLeafMessageId: null,
      reminderSent: false,
      pendingReset: false,
      recoveryPhase: "normal"
    };
    execution.state.dispatchState.conversationItems = [
      { role: "developer", content: "old window instructions" },
      { role: "user", content: "current user request" },
      { role: "user", content: "[System: Call final_response if ready.]" },
      { role: "assistant", content: "old assistant output" }
    ];
    mockedResetV2ContextWindow.mockImplementationOnce(async (contextExecution, _reason, seedItems) => {
      contextExecution.state.dispatchState.conversationItems = seedItems ?? [];
    });

    await runAgentStepLoop(execution as never);

    expect(mockedResetV2ContextWindow).toHaveBeenCalledWith(
      execution,
      "provider_overflow",
      [{ role: "user", content: "current user request" }]
    );
    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(2);
    expect((mockedCreateModelResponseWithRetry.mock.calls[1]?.[1] as { conversationItems: unknown }).conversationItems)
      .toEqual([{ role: "user", content: "current user request" }]);
    expect(execution.state.finalResponseFromTool).toEqual({
      response: "Recovered.",
      notify: true
    });
  });

  it("does not retry again when the fresh v2 context is also rejected", async () => {
    const overflowError = new Error("Your input exceeds the context window of this model.");
    mockedCreateModelResponseWithRetry
      .mockRejectedValueOnce(overflowError)
      .mockRejectedValueOnce(overflowError);

    const execution = createExecutionContext();
    execution.state.contextManagement = {
      version: "v2",
      taskId: "task-1",
      firstWindowId: "window-1",
      windowId: "window-1",
      contextNodeId: "node-1",
      previousWindowId: null,
      branchLeafMessageId: null,
      reminderSent: false,
      pendingReset: false,
      recoveryPhase: "normal"
    };
    execution.state.dispatchState.conversationItems = [{ role: "user", content: "current user request" }];

    await expect(runAgentStepLoop(execution as never)).rejects.toThrow(overflowError);

    expect(mockedResetV2ContextWindow).toHaveBeenCalledOnce();
    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(2);
  });

  it("requires an explicit action during Long Horizon clarify", async () => {
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({
      output: [],
      output_text: "",
      usage: undefined
    } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: true,
      sawFunctionToolCall: true,
      finalResponse: null,
      waitRequest: null,
      stopRequest: null,
      workflowPause: { kind: "long_horizon_started" }
    });

    const execution = createExecutionContext();
    execution.job.mode = "long_horizon_clarify";
    execution.workflow.workflowContext = {
      workflowTaskId: "workflow-1",
      workflowType: "long_horizon",
      phase: "clarify",
      config: {},
      taskId: "task-1",
      taskDir: "/tmp/task-1",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      currentAgent: null,
      agents: [],
      planContent: null
    };
    execution.workflow.allowWorkflowStartLongHorizon = true;
    execution.workflow.allowWorkflowRequestClarification = true;

    await runAgentStepLoop(execution as never);

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ toolChoice: "required" }),
      expect.any(Function)
    );
  });
});
