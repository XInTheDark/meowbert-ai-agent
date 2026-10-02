import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAgentTurnRequest } from "./turn-request.js";

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

vi.mock("../computer/desktop-computer-status.js", () => ({
  buildDesktopComputerUnavailableMessage: vi.fn(() => "desktop unavailable")
}));

vi.mock("../context-compaction/index.js", () => ({
  compactContextNow: vi.fn(async () => ({ status: "compacted" })),
  emitActualContextUsage: vi.fn(),
  estimateContextTokens: vi.fn(() => 0),
  maybeAutoCompactContext: vi.fn(async () => ({ status: "skipped" })),
  recoverContextAfterContextWindowError: vi.fn(async () => ({ status: "compacted" }))
}));

vi.mock("../context-management/index.js", () => ({
  checkpointAndTrimContext: vi.fn(),
  persistContextCheckpoint: vi.fn()
}));

vi.mock("./model.js", () => ({
  createModelResponseWithRetry: vi.fn()
}));

vi.mock("./model-request-recovery.js", () => ({
  persistModelRequestRecovery: vi.fn()
}));

vi.mock("./context-window.js", () => ({
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

vi.mock("../agent-tool-dispatch/index.js", () => ({
  dispatchResponseOutput: vi.fn()
}));

vi.mock("./turn-request.js", () => ({
  buildAgentTurnRequest: vi.fn(() => ({
    responseTools: [],
    promptPrefixItems: [],
    promptPrefixHash: "prefix-hash",
    promptRevision: "prompt-revision",
    promptCacheKey: "prompt-cache-key"
  }))
}));

vi.mock("./prompt-envelope.js", () => ({
  appendPromptEnvelopeDelta: vi.fn(),
  sealPromptEnvelope: vi.fn()
}));

vi.mock("./queued-prompt-deltas.js", () => ({
  appendQueuedPromptDeltas: vi.fn()
}));

vi.mock("../tasks/subscription-usage.js", () => ({
  computeEstimatedCostUsageForModel: vi.fn(async () => ({
    resolvedModel: "gpt-test",
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    billableInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    visibleOutputTokens: 0,
    multipliers: {
      inputTokens: 1,
      cachedInputTokens: 1,
      cacheWriteInputTokens: 1.25,
      outputTokens: 1,
      reasoningTokens: 1
    },
    rateMultiplier: 1,
    weightedTokens: 0
  })),
  getUserMonthlySubscriptionQuotaStatus: vi.fn(),
  recordPlatformTokenUsageEvent: vi.fn()
}));

vi.mock("../task-workflows/service.js", () => ({
  createSwarmChannelForAgent: vi.fn(),
  cancelSwarmNode: vi.fn(),
  canRecordSwarmFinalReview: vi.fn(() => false),
  canRecordSwarmReview: vi.fn(() => false),
  getSwarmBudgetStatus: vi.fn(),
  grantSwarmNodeBudget: vi.fn(),
  listSwarmChannelsForAgent: vi.fn(),
  recordSwarmFinalReview: vi.fn(),
  requiresSwarmFinalReview: vi.fn((context) =>
    context?.workflowType === "agent_swarm" && context.agents.some((agent: { role: string }) => agent.role === "worker")
  ),
  maybeRefreshSwarmInbox: vi.fn(),
  pauseSwarmAgent: vi.fn(),
  readSwarmChannel: vi.fn(),
  refreshSwarmInbox: vi.fn(),
  releaseSwarmInference: vi.fn(),
  reserveSwarmInference: vi.fn(),
  settleSwarmInference: vi.fn(),
  sendSwarmChannelMessage: vi.fn(),
  spawnSwarmNode: vi.fn(),
  startLongHorizonTask: vi.fn(),
  submitLongHorizonResponse: vi.fn(),
  submitLongHorizonReview: vi.fn(),
  wakeParentForSwarmQuota: vi.fn()
}));

vi.mock("../tasks/recurring-run-utils.js", () => ({
  buildTimedRunFinalizationMessage: vi.fn(() => "timed finalization")
}));

import { createModelResponseWithRetry } from "./model.js";
import { persistModelRequestRecovery } from "./model-request-recovery.js";
import { dispatchResponseOutput } from "../agent-tool-dispatch/index.js";
import {
  compactContextNow,
  emitActualContextUsage,
  recoverContextAfterContextWindowError
} from "../context-compaction/index.js";
import { persistContextCheckpoint } from "../context-management/index.js";
import {
  computeEstimatedCostUsageForModel,
  getUserMonthlySubscriptionQuotaStatus,
  recordPlatformTokenUsageEvent
} from "../tasks/subscription-usage.js";
import { runAgentStepLoop } from "./loop.js";
import {
  pauseSwarmAgent,
  releaseSwarmInference,
  reserveSwarmInference,
  settleSwarmInference,
  wakeParentForSwarmQuota
} from "../task-workflows/service.js";
import { resetV2ContextWindow } from "./context-window.js";
import {
  REFRESH_INBOX_TOOL_NAME,
  SEND_CHANNEL_MESSAGE_TOOL_NAME
} from "../agent-tools/index.js";

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
      runtimeProvider: "openai",
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
      emitNetworkRequestLog: vi.fn(),
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
      subscriptionUserId: null,
      subscriptionUserIsSuperAdmin: false,
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
      allowSwarmTools: false
    },
    systemPrompt: "system prompt",
    promptEnvelope: {},
    runControl: {
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
      shouldRecordTokenUsage: false,
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
  execution.runControl.isTimedInfiniteRun = true;
  execution.runControl.runTimeLimitController = deadlineController;
  execution.runControl.runAbortSignal = deadlineController.signal;
  execution.assertRunNotAborted.mockRejectedValue(new Error("RUN_TIME_LIMIT_REACHED"));
  return execution;
}

describe("runAgentStepLoop", () => {
  const mockedCreateModelResponseWithRetry = vi.mocked(createModelResponseWithRetry);
  const mockedDispatchResponseOutput = vi.mocked(dispatchResponseOutput);
  const mockedRecoverContextAfterContextWindowError = vi.mocked(recoverContextAfterContextWindowError);
  const mockedCompactContextNow = vi.mocked(compactContextNow);
  const mockedEmitActualContextUsage = vi.mocked(emitActualContextUsage);
  const mockedPersistContextCheckpoint = vi.mocked(persistContextCheckpoint);
  const mockedResetV2ContextWindow = vi.mocked(resetV2ContextWindow);
  const mockedPersistModelRequestRecovery = vi.mocked(persistModelRequestRecovery);
  const mockedComputeEstimatedCostUsageForModel = vi.mocked(computeEstimatedCostUsageForModel);
  const mockedGetUserMonthlySubscriptionQuotaStatus = vi.mocked(getUserMonthlySubscriptionQuotaStatus);
  const mockedRecordPlatformTokenUsageEvent = vi.mocked(recordPlatformTokenUsageEvent);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetUserMonthlySubscriptionQuotaStatus.mockResolvedValue({
      used: 0,
      limit: 0,
      exceeded: false
    });
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
    expect(execution.runControl.runTimedOut).toBe(true);
    expect(execution.runControl.reachedMaxRunSteps).toBe(false);
    expect(execution.state.finalResponseFromTool).toEqual(finalResponse);
  });

  it("does not dispatch a Swarm response quarantined after its deadline", async () => {
    const execution = createExecutionContext();
    execution.workflow.workflowContext = {
      workflowTaskId: "task-1",
      workflowType: "agent_swarm",
      phase: "active",
      config: { tokenBudget: 10_000 },
      taskId: "task-1",
      taskDir: "/tmp/task-1",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      currentAgent: null,
      agents: [],
      planContent: null,
      runtime: { lastPassiveRefreshAtMs: 0, lastExplicitRefreshWorkflowMessageNo: 0, pendingChannelMessageSendAfterRefresh: false }
    };
    execution.workflow.allowSwarmTools = true;
    vi.mocked(reserveSwarmInference).mockResolvedValueOnce({
      reservationId: "reservation-1",
      requestedTokens: 512,
      nodeId: "node-1",
      workflowAgentId: "agent-1",
      recovery: false,
      runId: "run-1"
    });
    vi.mocked(settleSwarmInference).mockResolvedValueOnce(false);
    vi.mocked(releaseSwarmInference).mockResolvedValue(undefined);
    vi.mocked(pauseSwarmAgent).mockResolvedValue(undefined);
    vi.mocked(wakeParentForSwarmQuota).mockResolvedValue(undefined);
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({ output: [], output_text: "" } as never);

    await runAgentStepLoop(execution as never);

    expect(mockedDispatchResponseOutput).not.toHaveBeenCalled();
    expect(pauseSwarmAgent).toHaveBeenCalledOnce();
    expect(wakeParentForSwarmQuota).toHaveBeenCalledOnce();
    expect(execution.state.workflowPauseRequest).toEqual({ kind: "agent_swarm_paused" });
  });

  it("finishes with the timeout message if the wrap-up turn fails", async () => {
    const execution = createExpiredTimedExecutionContext();
    mockedCreateModelResponseWithRetry.mockRejectedValueOnce(new Error("Provider unavailable"));

    await expect(runAgentStepLoop(execution)).resolves.toBeUndefined();

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(1);
    expect(execution.runControl.reachedMaxRunSteps).toBe(false);
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

    expect(execution.runControl.runTimedOut).toBe(false);
    expect(execution.state.finalResponseFromTool).toBeNull();
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
    expect(execution.runControl.reachedMaxRunSteps).toBe(false);
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
    expect(execution.runControl.reachedMaxRunSteps).toBe(false);
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
    expect(execution.runControl.reachedMaxRunSteps).toBe(true);
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
    expect(execution.runControl.reachedMaxRunSteps).toBe(true);
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

  it("records platform token usage even when the user has no quota plan", async () => {
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
    execution.prepared.subscriptionUserId = "user-1";

    await runAgentStepLoop(execution as never);

    expect(mockedGetUserMonthlySubscriptionQuotaStatus).toHaveBeenCalledWith("user-1");
    expect(mockedComputeEstimatedCostUsageForModel).toHaveBeenCalledWith(expect.objectContaining({
      inputTokens: 120,
      cachedInputTokens: 20,
      cacheWriteInputTokens: 30,
      outputTokens: 30,
      reasoningTokens: 10
    }));
    expect(mockedRecordPlatformTokenUsageEvent).toHaveBeenCalledWith(
      { userId: "user-1", taskId: "task-1", runId: "run-1" },
      expect.objectContaining({ inputTokens: 120, cachedInputTokens: 20, outputTokens: 30, reasoningTokens: 10 }),
      expect.objectContaining({ resolvedModel: "gpt-test" })
    );
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
      taskId: "task-1",
      step: 0,
      maxContextTokens: 128_000,
      inputTokens: 120,
      cachedTokens: 20,
      prefixHash: "prefix-hash",
      promptRevision: "prompt-revision"
    });
  });

  it("records platform token usage for every Agent Swarm leader and worker run", async () => {
    mockedCreateModelResponseWithRetry.mockResolvedValue({
      output: [],
      output_text: "Done.",
      usage: {
        input_tokens: 90,
        output_tokens: 15
      }
    } as never);
    mockedDispatchResponseOutput.mockResolvedValue({
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

    for (const run of [
      { taskId: "leader-task", runId: "leader-run", mode: "agent_swarm_leader" },
      { taskId: "worker-task-1", runId: "worker-run-1", mode: "agent_swarm_worker" },
      { taskId: "worker-task-2", runId: "worker-run-2", mode: "agent_swarm_worker" }
    ]) {
      const execution = createExecutionContext();
      execution.job.taskId = run.taskId;
      execution.job.runId = run.runId;
      execution.job.mode = run.mode;
      execution.prepared.subscriptionUserId = "user-1";
      execution.workflow.workflowContext = {
        workflowType: "agent_swarm",
        phase: "active",
        config: {},
        currentAgent: {
          role: run.mode === "agent_swarm_leader" ? "leader" : "worker"
        }
      };

      await runAgentStepLoop(execution as never);
    }

    expect(mockedRecordPlatformTokenUsageEvent).toHaveBeenCalledTimes(3);
    expect(mockedRecordPlatformTokenUsageEvent).toHaveBeenCalledWith(
      { userId: "user-1", taskId: "leader-task", runId: "leader-run" },
      expect.objectContaining({ inputTokens: 90, outputTokens: 15 }),
      expect.anything()
    );
    expect(mockedRecordPlatformTokenUsageEvent).toHaveBeenCalledWith(
      { userId: "user-1", taskId: "worker-task-1", runId: "worker-run-1" },
      expect.objectContaining({ inputTokens: 90, outputTokens: 15 }),
      expect.anything()
    );
    expect(mockedRecordPlatformTokenUsageEvent).toHaveBeenCalledWith(
      { userId: "user-1", taskId: "worker-task-2", runId: "worker-run-2" },
      expect.objectContaining({ inputTokens: 90, outputTokens: 15 }),
      expect.anything()
    );
  });

  it("records admin platform token usage without enforcing quota", async () => {
    mockedGetUserMonthlySubscriptionQuotaStatus.mockResolvedValueOnce({
      used: 10_000,
      limit: 1,
      exceeded: true
    });
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({
      output: [],
      output_text: "",
      usage: {
        input_tokens: 42,
        output_tokens: 8
      }
    } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: true,
      sawFunctionToolCall: true,
      finalResponse: { response: "Admin done.", notify: true },
      waitRequest: null,
      stopRequest: null,
      workflowPause: null
    });

    const execution = createExecutionContext();
    execution.prepared.subscriptionUserId = "admin-1";
    execution.prepared.resolvedRunActorIsSuperAdmin = true;

    await runAgentStepLoop(execution as never);

    expect(mockedGetUserMonthlySubscriptionQuotaStatus).not.toHaveBeenCalled();
    expect(execution.state.finalResponseFromTool).toEqual({ response: "Admin done.", notify: true });
    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledTimes(1);
    expect(mockedRecordPlatformTokenUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "admin-1" }),
      expect.objectContaining({ inputTokens: 42, outputTokens: 8 }),
      expect.anything()
    );
  });

  it("records usage for an admin-initiated task run by a non-admin without enforcing quota", async () => {
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({
      output: [],
      output_text: "",
      usage: {
        input_tokens: 42,
        output_tokens: 8
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
    execution.prepared.subscriptionUserId = "admin-1";
    execution.prepared.subscriptionUserIsSuperAdmin = true;
    execution.prepared.resolvedRunActorIsSuperAdmin = false;

    await runAgentStepLoop(execution as never);

    expect(mockedGetUserMonthlySubscriptionQuotaStatus).not.toHaveBeenCalled();
    expect(mockedRecordPlatformTokenUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "admin-1" }),
      expect.objectContaining({ inputTokens: 42, outputTokens: 8 }),
      expect.anything()
    );
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

  it("lets the leader choose a direct action before and after kickoff", async () => {
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({
      output: [],
      output_text: "",
      usage: undefined
    } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: false,
      sawFunctionToolCall: false,
      finalResponse: null,
      waitRequest: {
        seconds: 60,
        response: "pause",
        notify: true,
        nextRunAt: "2026-03-18T00:01:00.000Z"
      },
      stopRequest: null,
      workflowPause: null
    });

    const execution = createExecutionContext();
    execution.job.mode = "agent_swarm_leader";
    execution.workflow.workflowContext = {
      workflowTaskId: "workflow-1",
      workflowType: "agent_swarm",
      phase: "active",
      config: {},
      taskId: "task-1",
      taskDir: "/tmp/task-1",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      currentAgent: {
        id: "leader-agent",
        role: "leader",
        slot_index: 0,
        task_id: "task-1",
        title: "Leader",
        status: "running",
        task_root_path: ".meowbert/task-runs/task-1",
        last_inbox_refresh_message_no: 0
      },
      agents: [{
        id: "worker-agent",
        role: "worker",
        slot_index: 0,
        task_id: "worker-1",
        title: "Worker 1",
        status: "queued",
        task_root_path: ".meowbert/task-runs/worker-1",
        last_inbox_refresh_message_no: 0,
        state_json: {}
      }],
      planContent: null,
      swarm: {
        sharedDir: "/tmp/shared",
        channels: [],
        peerTaskDirs: [],
        globalChannelId: "global-channel",
        latestWorkflowMessageNo: 30,
        leaderGlobalMessageCount: 0,
        activeWorkerCount: 0,
        workerGlobalReportTaskIds: [],
        workerGlobalReportLabels: [],
        missingWorkerGlobalReportTaskIds: ["worker-1"],
        missingWorkerGlobalReportLabels: ["Worker 1"],
        workersStartedAt: null
      },
      runtime: {
        lastPassiveRefreshAtMs: 0,
        lastExplicitRefreshWorkflowMessageNo: 0,
        pendingChannelMessageSendAfterRefresh: false
      }
    };
    execution.workflow.allowSwarmTools = true;

    await runAgentStepLoop(execution as never);

    expect(buildAgentTurnRequest).toHaveBeenCalledWith(expect.objectContaining({
      availability: expect.objectContaining({ allowWaitTool: true })
    }));
    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ toolChoice: "required" }),
      expect.any(Function)
    );

    execution.workflow.workflowContext.swarm.leaderGlobalMessageCount = 1;
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({
      output: [], output_text: "", usage: undefined
    } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: false,
      sawFunctionToolCall: false,
      finalResponse: null,
      waitRequest: {
        seconds: 60, response: "pause", notify: true, nextRunAt: "2026-03-18T00:01:00.000Z"
      },
      stopRequest: null,
      workflowPause: null
    });
    await runAgentStepLoop(execution as never);

    expect(mockedCreateModelResponseWithRetry).toHaveBeenLastCalledWith(
      "task-1",
      expect.objectContaining({ toolChoice: "required" }),
      expect.any(Function)
    );
  });

  it("does not force a swarm message after an inbox refresh", async () => {
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({
      output: [],
      output_text: "",
      usage: undefined
    } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: false,
      sawFunctionToolCall: false,
      finalResponse: null,
      waitRequest: {
        seconds: 60,
        response: "pause",
        notify: true,
        nextRunAt: "2026-03-18T00:01:00.000Z"
      },
      stopRequest: null,
      workflowPause: null
    });

    const execution = createExecutionContext();
    execution.job.mode = "agent_swarm_leader";
    execution.workflow.workflowContext = {
      workflowTaskId: "workflow-1",
      workflowType: "agent_swarm",
      phase: "active",
      config: {},
      taskId: "task-1",
      taskDir: "/tmp/task-1",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      currentAgent: {
        id: "leader-agent",
        role: "leader",
        slot_index: 0,
        task_id: "task-1",
        title: "Leader",
        status: "running",
        task_root_path: ".meowbert/task-runs/task-1",
        last_inbox_refresh_message_no: 29
      },
      agents: [],
      planContent: null,
      swarm: {
        sharedDir: "/tmp/shared",
        channels: [],
        peerTaskDirs: [],
        globalChannelId: "global-channel",
        latestWorkflowMessageNo: 29,
        leaderGlobalMessageCount: 0,
        activeWorkerCount: 0,
        workerGlobalReportTaskIds: [],
        workerGlobalReportLabels: [],
        missingWorkerGlobalReportTaskIds: ["worker-1"],
        missingWorkerGlobalReportLabels: ["Worker 1"],
        workersStartedAt: null
      },
      runtime: {
        lastPassiveRefreshAtMs: 0,
        lastExplicitRefreshWorkflowMessageNo: 29,
        pendingChannelMessageSendAfterRefresh: true
      }
    };
    execution.workflow.allowSwarmTools = true;

    await runAgentStepLoop(execution as never);

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ toolChoice: "required" }),
      expect.any(Function)
    );
  });

  it("does not force a specific kickoff swarm tool for ordinary swarm steps", async () => {
    mockedCreateModelResponseWithRetry.mockResolvedValueOnce({
      output: [],
      output_text: "",
      usage: undefined
    } as never);
    mockedDispatchResponseOutput.mockResolvedValueOnce({
      sawToolCall: false,
      sawFunctionToolCall: false,
      finalResponse: null,
      waitRequest: {
        seconds: 60,
        response: "pause",
        notify: true,
        nextRunAt: "2026-03-18T00:01:00.000Z"
      },
      stopRequest: null,
      workflowPause: null
    });

    const execution = createExecutionContext();
    execution.job.mode = "agent_swarm_leader";
    execution.workflow.workflowContext = {
      workflowTaskId: "workflow-1",
      workflowType: "agent_swarm",
      phase: "active",
      config: {},
      taskId: "task-1",
      taskDir: "/tmp/task-1",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      currentAgent: {
        id: "leader-agent",
        role: "leader",
        slot_index: 0,
        task_id: "task-1",
        title: "Leader",
        status: "running",
        task_root_path: ".meowbert/task-runs/task-1",
        last_inbox_refresh_message_no: 29
      },
      agents: [],
      planContent: null,
      swarm: {
        sharedDir: "/tmp/shared",
        channels: [],
        peerTaskDirs: [],
        globalChannelId: "global-channel",
        latestWorkflowMessageNo: 30,
        leaderGlobalMessageCount: 1,
        activeWorkerCount: 3,
        workerGlobalReportTaskIds: [],
        workerGlobalReportLabels: [],
        missingWorkerGlobalReportTaskIds: ["worker-1"],
        missingWorkerGlobalReportLabels: ["Worker 1"],
        workersStartedAt: "2026-03-18T00:00:10.000Z"
      },
      runtime: {
        lastPassiveRefreshAtMs: 0,
        lastExplicitRefreshWorkflowMessageNo: 29,
        pendingChannelMessageSendAfterRefresh: false
      }
    };
    execution.workflow.allowSwarmTools = true;

    await runAgentStepLoop(execution as never);

    expect(mockedCreateModelResponseWithRetry).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        toolChoice: "required"
      }),
      expect.any(Function)
    );
    expect(mockedCreateModelResponseWithRetry).not.toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        toolChoice: {
          type: "function",
          name: REFRESH_INBOX_TOOL_NAME
        }
      }),
      expect.any(Function)
    );
    expect(mockedCreateModelResponseWithRetry).not.toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        toolChoice: {
          type: "function",
          name: SEND_CHANNEL_MESSAGE_TOOL_NAME
        }
      }),
      expect.any(Function)
    );
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
      planContent: null,
      runtime: {
        lastPassiveRefreshAtMs: 0,
        lastExplicitRefreshWorkflowMessageNo: 0,
        pendingChannelMessageSendAfterRefresh: false
      }
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
