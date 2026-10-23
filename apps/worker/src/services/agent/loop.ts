import { appendSubagentInbox } from "../subagents/inbox.js";
import { appendProjectMasterInbox } from "../project-master/inbox.js";
import { getVisiblePlatformAgentPresets, parseModelResponseUsage, resolveCodeModeForModel } from "@meowbert/shared";
import { getPersistentRuntimeEnabled, getSandboxNetworkEnabled, WORKSPACE_DEFAULT_TOOLSET_CANVAS_SKILL_ID as CANVAS_SKILL_ID } from "@meowbert/shared";
import { calculateContextUsagePercent } from "@meowbert/shared/context-usage";
import { emitTaskEvent } from "../runtime/events.js";
import { appendMessage } from "../agent-db/index.js";
import { getDesktopComputerPresence } from "../computer/computer-use.js";
import { buildDesktopComputerUnavailableMessage } from "../computer/desktop-computer-status.js";
import {
  compactContextNow,
  emitActualContextUsage,
  estimateContextTokens,
  maybeAutoCompactContext,
  recoverContextAfterContextWindowError
} from "../context-compaction/index.js";
import { checkpointAndTrimContext, persistContextCheckpoint } from "../context-management/index.js";
import { buildContextReminder } from "../context-management-v2/index.js";
import { resetV2ContextWindow, selectContextOverflowRecoveryItems } from "./context-window.js";
import { createModelResponseWithRetry, type ModelToolChoice } from "./model.js";
import { resolveModelErrorAction } from "./model-error-actions.js";
import { persistModelRequestRecovery } from "./model-request-recovery.js";
import { dispatchResponseOutput, type ToolDispatchContext } from "../agent-tool-dispatch/index.js";
import { buildAgentTurnRequest } from "./turn-request.js";
import type { FunctionTool } from "openai/resources/responses/responses";
import { appendPromptEnvelopeDelta, sealPromptEnvelope } from "./prompt-envelope.js";
import { appendQueuedPromptDeltas } from "./queued-prompt-deltas.js";
import { runClaudeWebSearch } from "./claude-web-search.js";
import { resolveRunUsageBilling } from "./usage-billing.js";
import {
  computeEstimatedCostUsageForModel,
  getUserMonthlySubscriptionQuotaStatus,
  recordPlatformTokenUsageEvent
} from "../tasks/subscription-usage.js";
import {
  loadLongHorizonBudgetTelemetry,
  startLongHorizonTask,
  submitLongHorizonResponse,
  submitLongHorizonReview
} from "../task-workflows/service.js";
import { buildTimedRunFinalizationMessage } from "../tasks/recurring-run-utils.js";
import type { AgentExecutionContext, AgentStepAvailability, WorkflowActions } from "./execution-types.js";

const STEPS_REMAIN_THRESHOLD = 2;
const MAX_MODEL_REQUEST_RECOVERY_ITEMS = 6;
// How long Meridian keeps a Claude task's prompt cache warm after its latest request.
const CLAUDE_CACHE_KEEPALIVE_SECONDS = 30 * 60;

type ModelTurnResponse = Awaited<ReturnType<typeof createModelResponseWithRetry>>;

async function assertStepNotAborted(execution: AgentExecutionContext): Promise<void> {
  if (execution.runControl.timedRunFinalizing) {
    await execution.prepared.cancellationMonitor.assertNotCancelled();
  } else {
    await execution.assertRunNotAborted();
  }
}

function summarizeResponseOutputTypes(response: ModelTurnResponse): string[] {
  return response.output.reduce<string[]>((types, outputItem) => {
    if (typeof outputItem?.type === "string") {
      types.push(outputItem.type);
    }
    return types;
  }, []);
}

// Long Horizon runs move on only through their workflow tools.
function shouldRequireWorkflowToolAction(execution: AgentExecutionContext): boolean {
  return execution.workflow.workflowContext !== null;
}

function resolveStepAvailability(execution: AgentExecutionContext, step: number): AgentStepAvailability {
  return {
    allowFinalResponseTool: execution.workflow.workflowContext
      ? (execution.workflow.allowWorkflowFinalResponse && !execution.runControl.timedRunFinalizing)
      : (execution.job.mode !== "infinite_auto" || execution.runControl.timedRunFinalizing),
    allowWaitTool: execution.prepared.snapshot.task.allow_waiting !== false
      && !execution.runControl.timedRunFinalizing
      && !execution.workflow.workflowContext,
    allowStopTaskTool: execution.allowStopTask && !execution.runControl.timedRunFinalizing,
    requireWorkflowToolAction: shouldRequireWorkflowToolAction(execution),
    stepsRemaining: execution.maxRunSteps - step,
    isWindingDown: execution.maxRunSteps - step <= STEPS_REMAIN_THRESHOLD,
    quickModeActive: execution.state.quickModeActive
  };
}

function resolveModelToolChoice(
  execution: AgentExecutionContext,
  availability: AgentStepAvailability
): ModelToolChoice {
  if (availability.requireWorkflowToolAction) {
    return "required";
  }

  if (availability.allowWaitTool && !availability.allowFinalResponseTool) {
    return "required";
  }

  return "auto";
}

async function maybeApplySubscriptionQuota(execution: AgentExecutionContext): Promise<boolean> {
  if (!execution.prepared.subscriptionUserId) {
    return false;
  }

  execution.state.shouldRecordTokenUsage = true;
  if (execution.prepared.resolvedRunActorIsSuperAdmin || execution.prepared.subscriptionUserIsSuperAdmin) {
    return false;
  }

  const quota = await getUserMonthlySubscriptionQuotaStatus(execution.prepared.subscriptionUserId);
  if (quota.limit <= 0 || !quota.exceeded) {
    return false;
  }

  execution.state.finalResponseFromTool = {
    response: "Subscription usage limit reached. Please switch to BYO provider or ask an admin for a higher plan quota.",
    notify: true
  };
  return true;
}

function maybeAppendWindingDownNotice(execution: AgentExecutionContext, availability: AgentStepAvailability): void {
  if (!availability.isWindingDown && !execution.runControl.timedRunFinalizing) {
    return;
  }

  execution.state.dispatchState.conversationItems.push({
    role: "user",
    content: execution.runControl.timedRunFinalizing
      ? buildTimedRunFinalizationMessage()
      : availability.allowFinalResponseTool
        ? `[System: You have ${availability.stepsRemaining} step(s) remaining. Call final_response now to deliver your answer.]`
        : availability.allowWaitTool
          ? `[System: You have ${availability.stepsRemaining} step(s) remaining. Call wait now with {seconds, response, notify} to save your update and schedule the next cycle.]`
          : `[System: You have ${availability.stepsRemaining} step(s) remaining. Waiting is disabled for this task and final_response is not available yet. Keep working and use tools to make progress.]`
  });
}

async function maybeRunAutoCompaction(execution: AgentExecutionContext, step: number): Promise<void> {
  if (execution.state.contextManagement.version === "v2") {
    const usage = execution.state.dispatchState.contextUsage;
    if (!usage) return;
    const reminderThreshold = Math.min(6_144, Math.max(1_024, Math.floor(usage.maxContextTokens * 0.08)));
    const reserve = Math.min(16_384, Math.max(2_048, Math.floor(usage.maxContextTokens * 0.2)));
    const remaining = Math.max(0, usage.maxContextTokens - usage.usedTokens);
    if (!execution.state.contextManagement.reminderSent && remaining <= reminderThreshold) {
      execution.state.dispatchState.conversationItems.push({ role: "developer", content: buildContextReminder(remaining) });
      execution.state.contextManagement.reminderSent = true;
    }
    if (remaining <= reserve) await resetV2ContextWindow(execution, "automatic");
    return;
  }
  const autoCompactionResult = await maybeAutoCompactContext({
    provider: execution.prepared.runtimeProvider,
    billing: resolveRunUsageBilling(execution),
    taskId: execution.job.taskId,
    step,
    model: execution.prepared.runtimeModel,
    compactionBackend: execution.prepared.snapshot.compaction_backend,
    requestTimeoutMs: execution.prepared.snapshot.model_request_timeout_ms,
    abortSignal: execution.runControl.timedRunFinalizing
      ? execution.prepared.cancellationMonitor.signal
      : execution.runControl.runAbortSignal,
    maxContextTokens: execution.prepared.maxContextTokens,
    platformModelMetadata: execution.prepared.snapshot.platform_model_metadata,
    systemPrompt: execution.systemPrompt,
    conversationItems: execution.state.dispatchState.conversationItems,
    runPersistedItems: execution.state.dispatchState.runPersistedItems,
    actualInputTokens: execution.state.lastActualContextUsage?.inputTokens,
    estimatedInputTokensAtActualMeasurement: execution.state.lastActualContextUsage?.estimatedInputTokens,
    emitPreUsage: !execution.state.hasActualContextUsage,
    getCurrentLeafMessageId: () => execution.state.currentLeafMessageId,
    setCurrentLeafMessageId: (messageId: string) => {
      execution.state.currentLeafMessageId = messageId;
    }
  });

  if (autoCompactionResult.status === "error") {
    await emitTaskEvent(execution.job.taskId, "error", {
      message: `Auto context compaction failed: ${autoCompactionResult.reason ?? "unknown error"}`
    });
  }
  if (autoCompactionResult.status === "compacted") {
    execution.state.lastActualContextUsage = null;
  }
}

async function appendComputerAvailabilityPrompt(execution: AgentExecutionContext): Promise<{
  allowComputerLocalShell: boolean;
  allowComputerVisualTools: boolean;
}> {
  if (execution.state.quickModeActive) {
    return { allowComputerLocalShell: false, allowComputerVisualTools: false };
  }

  const desktopComputerPresence = execution.prepared.runToolOptions.computerUse && execution.prepared.runActorUserId
    ? await getDesktopComputerPresence(execution.prepared.runActorUserId)
    : null;
  const allowComputerLocalShell =
    execution.prepared.runToolOptions.computerUse === true
    && desktopComputerPresence?.status.available === true;
  const allowComputerVisualTools =
    allowComputerLocalShell
    && desktopComputerPresence.status.canTakeScreenshot === true
    && desktopComputerPresence.status.canControlComputer === true;

  if (execution.prepared.runToolOptions.computerUse !== true) {
    return { allowComputerLocalShell, allowComputerVisualTools };
  }

  if (allowComputerVisualTools && desktopComputerPresence?.status.display) {
    appendPromptEnvelopeDelta(execution.promptEnvelope, {
      reason: "desktop-computer-availability",
      role: "system",
      content: [
        "Computer use is enabled for this run.",
        "`computer_local_shell` is available on the machine running Meowbert Desktop.",
        `Primary display size: ${desktopComputerPresence.status.display.width}x${desktopComputerPresence.status.display.height}.`,
        `Coordinate space for screenshots and future computer actions: ${desktopComputerPresence.status.display.coordinateSpaceWidth}x${desktopComputerPresence.status.display.coordinateSpaceHeight}.`,
        "Always start with `computer_screenshot` unless you already have a very recent computer observation in the conversation.",
        "All computer action coordinates are in the latest screenshot coordinate space, not raw desktop pixels."
      ].join(" ")
    });
  } else if (allowComputerLocalShell) {
    appendPromptEnvelopeDelta(execution.promptEnvelope, {
      reason: "desktop-computer-partial-availability",
      role: "system",
      content: [
        "A Meowbert Desktop executor is connected for this run.",
        "`computer_local_shell` is available on the local machine.",
        "Visual desktop control tools like screenshots, clicks, and typing are not ready yet.",
        desktopComputerPresence?.status.reason ?? "Required desktop permissions are still missing."
      ].join(" ")
    });
  } else {
    appendPromptEnvelopeDelta(execution.promptEnvelope, {
      reason: "desktop-computer-unavailable",
      role: "system",
      content: buildDesktopComputerUnavailableMessage(desktopComputerPresence?.status)
    });
  }

  return { allowComputerLocalShell, allowComputerVisualTools };
}

function buildWorkflowActions(execution: AgentExecutionContext): WorkflowActions | undefined {
  if (!execution.workflow.workflowContext) {
    return undefined;
  }

  return {
    startLongHorizonTask: execution.workflow.allowWorkflowStartLongHorizon
      ? async (plan: string) => startLongHorizonTask(execution.workflow.workflowContext!, {
        plan,
        workspaceId: execution.prepared.snapshot.task.workspace_id,
        environmentId: execution.prepared.snapshot.task.environment_id,
        triggerSource: execution.job.triggerSource,
        selectionUserId: execution.job.selectionUserId ?? null
      })
      : undefined,
    submitLongHorizonResponse: execution.workflow.allowWorkflowSubmitResponse
      ? async (message: string) => submitLongHorizonResponse(execution.workflow.workflowContext!, {
        message,
        workspaceId: execution.prepared.snapshot.task.workspace_id,
        environmentId: execution.prepared.snapshot.task.environment_id,
        triggerSource: execution.job.triggerSource
      })
      : undefined,
    submitLongHorizonReview: execution.workflow.allowWorkflowSubmitReview
      ? async (review: string, approved: boolean) => submitLongHorizonReview(execution.workflow.workflowContext!, {
        review,
        approved,
        workspaceId: execution.prepared.snapshot.task.workspace_id,
        environmentId: execution.prepared.snapshot.task.environment_id,
        triggerSource: execution.job.triggerSource
      })
      : undefined
  };
}

async function recordModelResponseUsage(input: {
  execution: AgentExecutionContext;
  response: ModelTurnResponse;
  step: number;
  promptPrefixHash: string;
  promptRevision: string;
}): Promise<void> {
  if (typeof input.response.usage?.input_tokens !== "number") {
    input.execution.state.lastActualContextUsage = null;
    input.execution.state.dispatchState.contextUsage = null;
    return;
  }

  const inputTokens = Math.max(0, Math.floor(input.response.usage.input_tokens));
  input.execution.state.hasActualContextUsage = true;
  input.execution.state.lastActualContextUsage = {
    inputTokens,
    estimatedInputTokens: estimateContextTokens(
      input.execution.systemPrompt,
      input.execution.state.dispatchState.conversationItems,
      input.execution.prepared.runtimeModel
    )
  };
  input.execution.state.dispatchState.contextUsage = {
    usedTokens: inputTokens,
    maxContextTokens: input.execution.prepared.maxContextTokens,
    percent: calculateContextUsagePercent(inputTokens, input.execution.prepared.maxContextTokens)
  };
  if (input.execution.state.contextManagement.version === "v2") {
    console.info("[context-management-v2]", JSON.stringify({
      version: "v2",
      itemCount: input.execution.state.dispatchState.conversationItems.length,
      tokenActual: inputTokens,
      latencyStep: input.step
    }));
  }
  await emitActualContextUsage({
    taskId: input.execution.job.taskId,
    step: input.step,
    maxContextTokens: input.execution.prepared.maxContextTokens,
    inputTokens,
    cachedTokens: input.response.usage.input_tokens_details?.cached_tokens,
    prefixHash: input.promptPrefixHash,
    promptRevision: input.promptRevision
  });
}

async function recordSubscriptionUsage(execution: AgentExecutionContext, response: ModelTurnResponse): Promise<number | null> {
  const counts = parseModelResponseUsage(response.usage);
  if (!counts) {
    return null;
  }

  try {
    const usage = await computeEstimatedCostUsageForModel({ model: execution.prepared.runtimeModel, ...counts });
    const billing = resolveRunUsageBilling(execution);
    if (billing && execution.state.shouldRecordTokenUsage) {
      await recordPlatformTokenUsageEvent(billing, counts, usage);
    }
    return usage.weightedTokens;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emitTaskEvent(execution.job.taskId, "error", {
      message: `Failed to record token usage event: ${message}`
    });
    return null;
  }
}

interface ModelTurnResult {
  response: ModelTurnResponse;
  requireWorkflowToolAction: boolean;
  codeModeTools: FunctionTool[];
}

// Code mode is a workspace experiment that each model can opt out of; the Master never uses it.
function isCodeModeEnabled(execution: AgentExecutionContext): boolean {
  return execution.prepared.snapshot.code_mode_enabled === true
    && execution.prepared.isProjectMaster !== true
    && resolveCodeModeForModel(execution.prepared.runtimeModel, execution.prepared.snapshot.platform_model_metadata);
}

async function requestModelTurn(input: {
  execution: AgentExecutionContext;
  step: number;
  availability: AgentStepAvailability;
  allowComputerLocalShell: boolean;
  allowComputerVisualTools: boolean;
}): Promise<ModelTurnResult> {
  const { execution, step, availability } = input;
  await appendQueuedPromptDeltas(execution);
  const turnRequest = buildAgentTurnRequest({
    taskId: execution.job.taskId,
    runToolOptions: execution.prepared.runToolOptions,
    activeSkillTools: execution.prepared.activeSkillTools,
    promptEnvelope: execution.promptEnvelope,
    availability: {
      allowFinalResponse: availability.allowFinalResponseTool,
      allowStopTask: availability.allowStopTaskTool,
      allowWaitTool: availability.allowWaitTool,
      allowScheduleTools: execution.allowScheduleTools,
      loadedToolGroups: [...execution.loadedToolGroups],
      allowSubtaskTools: execution.allowSubtaskTools,
      allowPdfFileTool: !execution.prepared.runtimeCompatibilityModes.includes("disablePdfFile"),
      newMessageOrganizationEnabled: Boolean(execution.state.dispatchState.organization),
      allowTaskHistoryTools: execution.prepared.memoryEnabled,
      allowProjectMasterTools: execution.prepared.isProjectMaster === true,
      projectMasterTaskRouter: execution.prepared.projectMasterTaskAgent?.router ?? null,
      allowLiveSyncTools: execution.prepared.liveSyncFiles.length > 0,
      allowLiveSyncFolderSearch: execution.prepared.liveSyncFiles.some((file) => file.provider === "google-drive" && file.linkKind === "folder"),
      allowCanvasTools: execution.prepared.snapshot.task.is_thread !== true
        && execution.prepared.runToolOptions.enabledSkills.includes(CANVAS_SKILL_ID),
      allowComputerLocalShell: input.allowComputerLocalShell,
      allowComputerVisualTools: input.allowComputerVisualTools,
      allowRefreshGitHubToken: execution.prepared.hasGitHubAppConnection,
      allowStartLongHorizonTask: execution.workflow.allowWorkflowStartLongHorizon,
      allowRequestClarification: execution.workflow.allowWorkflowRequestClarification,
      allowSubmitResponse: execution.workflow.allowWorkflowSubmitResponse,
      allowSubmitReview: execution.workflow.allowWorkflowSubmitReview,
      runShellMaxTimeoutSeconds: execution.prepared.runShellMaxTimeoutSeconds,
      quickModeActive: availability.quickModeActive,
      contextManagementVersion: execution.state.contextManagement.version,
      contextRecoveryPhase: execution.state.contextManagement.version === "v2"
        ? execution.state.contextManagement.recoveryPhase
        : undefined,
      allowPersistentShellSessions: getPersistentRuntimeEnabled(execution.prepared.runtimeEnvironmentPayload),
      useClaudeWebSearch: execution.prepared.runtimeModelType === "claude"
    },
    codeMode: isCodeModeEnabled(execution)
  });
  sealPromptEnvelope(execution.promptEnvelope);
  const toolChoice = resolveModelToolChoice(execution, availability);

  await emitTaskEvent(execution.job.taskId, "thinking_start", { step });
  let recoveredItemCount = 0;
  const response = await createModelResponseWithRetry(
      execution.job.taskId,
      {
      provider: execution.prepared.runtimeProvider,
      model: execution.prepared.runtimeModel,
      modelType: execution.prepared.runtimeModelType,
      compatibilityModes: execution.prepared.runtimeCompatibilityModes,
      requestTimeoutMs: execution.prepared.snapshot.model_request_timeout_ms,
      abortSignal: execution.runControl.timedRunFinalizing
        ? execution.prepared.cancellationMonitor.signal
        : execution.runControl.runAbortSignal,
      cacheUserId: execution.prepared.snapshot.task.initiator_user_id ?? execution.job.taskId,
      promptCacheKey: turnRequest.promptCacheKey,
      ...(execution.prepared.snapshot.enable_prompt_caching !== false ? { promptCacheTtl: "30m" as const } : {}),
      ...(execution.prepared.runtimeModelType === "claude" && execution.prepared.snapshot.claude_cache_keepalive
        ? { cacheKeepaliveSeconds: CLAUDE_CACHE_KEEPALIVE_SECONDS }
        : {}),
      prefixItems: turnRequest.promptPrefixItems,
      conversationItems: execution.state.dispatchState.conversationItems,
      modelPayload: execution.prepared.runtimeModelPayload,
      tools: turnRequest.responseTools,
      toolChoice,
      onNetworkRequest: execution.prepared.emitNetworkRequestLog,
      onConsecutiveErrorRecovery: async (errorMessage) => {
        if (recoveredItemCount >= MAX_MODEL_REQUEST_RECOVERY_ITEMS) {
          return false;
        }

        const recovered = await persistModelRequestRecovery({
          taskId: execution.job.taskId,
          errorMessage,
          conversationItems: execution.state.dispatchState.conversationItems,
          runPersistedItems: execution.state.dispatchState.runPersistedItems,
          historicalMessages: execution.prepared.snapshot.messages,
          getCurrentLeafMessageId: () => execution.state.currentLeafMessageId,
          setCurrentLeafMessageId: (messageId: string) => {
            execution.state.currentLeafMessageId = messageId;
          }
        });
        if (recovered) {
          if (execution.state.contextManagement.version === "v2") {
            await resetV2ContextWindow(
              execution,
              "model_request_recovery",
              execution.state.dispatchState.conversationItems.slice(2)
            );
          }
          recoveredItemCount += 1;
        }
        return recovered;
      }
      },
      async (retryMessage) => {
        execution.state.currentLeafMessageId = await appendMessage(execution.job.taskId, "system", { text: retryMessage }, {
          parentMessageId: execution.state.currentLeafMessageId
        });
      }
  );
  await emitTaskEvent(execution.job.taskId, "thinking_end", { step });
  await recordModelResponseUsage({
    execution,
    response,
    step,
    promptPrefixHash: turnRequest.promptPrefixHash,
    promptRevision: turnRequest.promptRevision
  });
  await recordSubscriptionUsage(execution, response);
  await assertStepNotAborted(execution);

  return { response, requireWorkflowToolAction: availability.requireWorkflowToolAction, codeModeTools: turnRequest.codeModeTools };
}

async function requestModelTurnWithRecovery(input: {
  execution: AgentExecutionContext;
  step: number;
  availability: AgentStepAvailability;
  allowComputerLocalShell: boolean;
  allowComputerVisualTools: boolean;
}): Promise<ModelTurnResult> {
  try {
    return await requestModelTurn(input);
  } catch (error) {
    if (resolveModelErrorAction(error) !== "compact_context") {
      throw error;
    }

    if (input.execution.state.contextManagement.version === "v2") {
      const message = error instanceof Error ? error.message : String(error);
      await emitTaskEvent(input.execution.job.taskId, "thinking_end", {
        step: input.step,
        recovery: "context_window_rollover"
      });
      await emitTaskEvent(input.execution.job.taskId, "log", {
        message: "Model request exceeded the context window. Opening a fresh context window and retrying the turn.",
        phase: "context_window_recovery",
        error: message
      });
      await resetV2ContextWindow(
        input.execution,
        "provider_overflow",
        selectContextOverflowRecoveryItems(input.execution.state.dispatchState.conversationItems)
      );
      return requestModelTurn(input);
    }

    const message = error instanceof Error ? error.message : String(error);
    await emitTaskEvent(input.execution.job.taskId, "thinking_end", {
      step: input.step,
      recovery: "context_compaction"
    });
    await emitTaskEvent(input.execution.job.taskId, "log", {
      message: "Model request exceeded the context window. Compacting context and retrying the turn.",
      phase: "context_compaction_recovery",
      error: message
    });

    const recoveryResult = await recoverContextAfterContextWindowError({
      provider: input.execution.prepared.runtimeProvider,
      billing: resolveRunUsageBilling(input.execution),
      taskId: input.execution.job.taskId,
      step: input.step,
      model: input.execution.prepared.runtimeModel,
      compactionBackend: input.execution.prepared.snapshot.compaction_backend,
      requestTimeoutMs: input.execution.prepared.snapshot.model_request_timeout_ms,
      abortSignal: input.execution.runControl.timedRunFinalizing
        ? input.execution.prepared.cancellationMonitor.signal
        : input.execution.runControl.runAbortSignal,
      maxContextTokens: input.execution.prepared.maxContextTokens,
      platformModelMetadata: input.execution.prepared.snapshot.platform_model_metadata,
      systemPrompt: input.execution.systemPrompt,
      conversationItems: input.execution.state.dispatchState.conversationItems,
      runPersistedItems: input.execution.state.dispatchState.runPersistedItems,
      getCurrentLeafMessageId: () => input.execution.state.currentLeafMessageId,
      setCurrentLeafMessageId: (messageId: string) => {
        input.execution.state.currentLeafMessageId = messageId;
      },
      reason: message
    });

    if (recoveryResult.status !== "compacted") {
      throw error;
    }

    return requestModelTurn(input);
  }
}

function buildDispatchContext(execution: AgentExecutionContext, codeModeTools: FunctionTool[]): ToolDispatchContext {
  const specializedModels = execution.prepared.snapshot.platform_specialized_models ?? {
    internalModel: null,
    fastModel: null,
    memorySynthesisAgent: null,
    reviewerAgent: null,
    subagentFastAgent: null
  };
  const presets = execution.prepared.snapshot.platform_agent_presets ?? [];
  return {
    subagentRuntime: { model: execution.prepared.runtimeModel, payload: execution.prepared.runtimeModelPayload,
      provider: { kind: execution.prepared.runtimeProviderKind ?? "platform", baseUrl: execution.prepared.runtimeProvider.baseUrl } },
    subagentFastAgent: specializedModels.subagentFastAgent,
    subagentPresets: getVisiblePlatformAgentPresets(presets, execution.prepared.resolvedRunActorIsSuperAdmin),
    allowTaskHistoryTools: execution.prepared.memoryEnabled,
    isProjectMaster: execution.prepared.isProjectMaster === true,
    projectMasterTaskAgent: execution.prepared.projectMasterTaskAgent ?? null,
    runId: execution.job.runId,
    taskId: execution.job.taskId,
    compatibilityModes: execution.prepared.runtimeCompatibilityModes,
    modelType: execution.prepared.runtimeModelType,
    ...(execution.prepared.runtimeModelType === "claude"
      ? {
        searchWeb: (query: string) => runClaudeWebSearch({
          provider: execution.prepared.runtimeProvider,
          billing: resolveRunUsageBilling(execution),
          model: execution.prepared.runtimeModel,
          query,
          abortSignal: execution.runControl.runAbortSignal
        })
      }
      : {}),
    contextManagementV2: execution.state.contextManagement.version === "v2"
      ? execution.state.contextManagement
      : null,
    workspaceId: execution.prepared.snapshot.task.workspace_id,
    environmentId: execution.prepared.snapshot.task.environment_id,
    actorUserId: execution.prepared.runActorUserId ?? null,
    selectionUserId: execution.job.selectionUserId ?? null,
    taskDir: execution.prepared.taskDir,
    taskScratchDir: execution.prepared.taskScratchDir,
    taskRootPath: execution.prepared.snapshot.task.task_root_path,
    envRoot: execution.prepared.envRoot,
    workspaceRoot: execution.prepared.workspaceRoot,
    liveSyncFiles: execution.prepared.liveSyncFiles,
    sandbox: execution.prepared.sandbox,
    shellEnvOverrides: execution.prepared.shellEnvOverrides,
    shellNetworkEnabled: getSandboxNetworkEnabled(execution.prepared.baseEnvironmentJsonPayload),
    workspaceRunAsRoot: execution.prepared.snapshot.environment?.workspace_run_as_root === true,
    triggerSource: execution.prepared.snapshot.task.source,
    connectorContextId: execution.prepared.snapshot.task.connector_context_id,
    defaultTimezone: execution.prepared.snapshot.task.default_timezone || "UTC",
    runMode: execution.job.mode ?? "default",
    runToolOptions: execution.prepared.runToolOptions,
    isThreadTask: execution.prepared.snapshot.task.is_thread,
    shellToolMaxTimeoutMs: execution.prepared.snapshot.shell_tool_max_timeout_ms,
    persistentRuntimeEnabled: getPersistentRuntimeEnabled(execution.prepared.runtimeEnvironmentPayload),
    imageDetail: execution.prepared.snapshot.image_detail ?? "high",
    skillsRootDir: execution.prepared.skillsRootDir,
    isSkillAdmin: execution.prepared.resolvedRunActorIsSuperAdmin,
    activeMcpConnections: execution.prepared.activeMcpConnections,
    activeSkillTools: execution.prepared.activeSkillTools,
    ...(codeModeTools.length > 0 ? { codeModeTools } : {}),
    enableSkillById: execution.enableSkillById,
    onDemandSkills: execution.onDemandCapabilities,
    appendPromptDelta: (promptDeltaInput) => {
      appendPromptEnvelopeDelta(execution.promptEnvelope, promptDeltaInput);
    },
    refreshGitHubToken: execution.prepared.refreshGitHubToken,
    workflowContext: execution.workflow.workflowContext,
    workflowActions: buildWorkflowActions(execution),
    getCurrentLeafMessageId: () => execution.state.currentLeafMessageId,
    setCurrentLeafMessageId: (messageId: string) => {
      execution.state.currentLeafMessageId = messageId;
    },
    cancellationSignal: execution.runControl.timedRunFinalizing
      ? execution.prepared.cancellationMonitor.signal
      : execution.runControl.runAbortSignal,
    assertNotCancelled: () => assertStepNotAborted(execution),
    initializeSandbox: execution.initializeQuickModeSandbox
  };
}

function handlePlainTextWithoutToolCall(
  execution: AgentExecutionContext,
  availability: AgentStepAvailability,
  requireWorkflowToolAction: boolean,
  sawFunctionToolCall: boolean
): void {
  if (sawFunctionToolCall) {
    return;
  }

  if (requireWorkflowToolAction) {
    execution.state.dispatchState.conversationItems.push({
      role: "user",
      content: availability.allowFinalResponseTool
        ? "[System: Workflow runs cannot finish via plain text. Call final_response explicitly.]"
        : "[System: Workflow runs cannot continue via plain text. Use the available workflow tool explicitly.]"
    });
    return;
  }

  if (availability.allowFinalResponseTool) {
    execution.state.dispatchState.conversationItems.push({
      role: "user",
      content: "[System: Continue working with tools. When the task is complete, call final_response explicitly; plain text does not finish the run.]"
    });
    return;
  }

  execution.state.dispatchState.conversationItems.push({
    role: "user",
    content: !availability.allowWaitTool
      ? "[System: Plain-text completion is not allowed yet. Waiting is disabled for this task, so continue working and use tools instead of concluding.]"
      : "[System: Do not stop yet. Either continue working with tools or call wait() explicitly when you want to pause.]"
  });
}

function handleNoToolCallFallback(execution: AgentExecutionContext, availability: AgentStepAvailability): "continue" | "break" {
  if (!availability.allowFinalResponseTool && !availability.allowWaitTool) {
    execution.state.dispatchState.conversationItems.push({
      role: "user",
      content: "[System: You must keep working in this run. Waiting is disabled and no completion tool is available yet. Continue with tools.]"
    });
    return "continue";
  }

  execution.state.dispatchState.conversationItems.push({
    role: "user",
    content: availability.allowFinalResponseTool && availability.allowWaitTool
      ? "[System: Your previous turn produced no answer text and no tool calls. Call final_response() if you are done, use wait() for a bounded delay or shell-session condition, or keep working with tools.]"
      : availability.allowFinalResponseTool
        ? "[System: Your previous turn produced no answer text and no tool calls. Explicitly call final_response() if you are ready to answer, or keep working with tools.]"
        : availability.allowWaitTool
          ? "[System: Your previous turn produced no answer text and no tool calls. Keep working with tools, or call wait() explicitly if you want to pause.]"
          : "[System: Your previous turn produced no answer text and no tool calls. Continue with tools.]"
  });
  return "continue";
}

async function applyPendingContextManagementAction(
  execution: AgentExecutionContext,
  step: number
): Promise<boolean> {
  const action = execution.state.dispatchState.pendingContextManagementAction;
  if (!action) {
    return false;
  }
  execution.state.dispatchState.pendingContextManagementAction = null;

  if (action.kind === "compact") {
    const compactResult = await compactContextNow({
      provider: execution.prepared.runtimeProvider,
      billing: resolveRunUsageBilling(execution),
      taskId: execution.job.taskId,
      step,
      model: execution.prepared.runtimeModel,
      compactionBackend: execution.prepared.snapshot.compaction_backend,
      requestTimeoutMs: execution.prepared.snapshot.model_request_timeout_ms,
      abortSignal: execution.runControl.runAbortSignal,
      maxContextTokens: execution.prepared.maxContextTokens,
      platformModelMetadata: execution.prepared.snapshot.platform_model_metadata,
      systemPrompt: execution.systemPrompt,
      conversationItems: execution.state.dispatchState.conversationItems,
      runPersistedItems: execution.state.dispatchState.runPersistedItems,
      getCurrentLeafMessageId: () => execution.state.currentLeafMessageId,
      setCurrentLeafMessageId: (messageId: string) => {
        execution.state.currentLeafMessageId = messageId;
      }
    });
    if (compactResult.status === "error") {
      throw new Error(`Context compaction failed: ${compactResult.reason ?? "unknown error"}`);
    }
    await persistContextCheckpoint({
      taskId: execution.job.taskId,
      action: "compact",
      checkpoint: action.checkpoint,
      conversationItems: execution.state.dispatchState.conversationItems,
      runPersistedItems: execution.state.dispatchState.runPersistedItems,
      getCurrentLeafMessageId: () => execution.state.currentLeafMessageId,
      setCurrentLeafMessageId: (messageId: string) => {
        execution.state.currentLeafMessageId = messageId;
      }
    });
  } else {
    await checkpointAndTrimContext({
      taskId: execution.job.taskId,
      checkpoint: action.checkpoint,
      toolSummary: action.toolSummary,
      count: action.count,
      triggeringCallId: action.callId,
      conversationItems: execution.state.dispatchState.conversationItems,
      runPersistedItems: execution.state.dispatchState.runPersistedItems,
      getCurrentLeafMessageId: () => execution.state.currentLeafMessageId,
      setCurrentLeafMessageId: (messageId: string) => {
        execution.state.currentLeafMessageId = messageId;
      }
    });
  }

  await emitTaskEvent(execution.job.taskId, "log", {
    message: action.kind === "compact"
      ? "Context checkpoint saved and context compacted."
      : `Context checkpoint saved and ${action.count} tool calls trimmed.`,
    phase: "context_management",
    action: action.kind
  });
  return true;
}

async function updateBudgetTelemetry(execution: AgentExecutionContext): Promise<void> {
  const workflowContext = execution.workflow.workflowContext;
  const lh = workflowContext?.longHorizon;
  if (!workflowContext || !lh || (!lh.tokenBudget && !lh.timeBudgetMinutes)) {
    execution.state.dispatchState.budgetTelemetry = null;
    return;
  }

  const telemetry = await loadLongHorizonBudgetTelemetry({
    workflowTaskId: workflowContext.workflowTaskId,
    timeBudgetMinutes: lh.timeBudgetMinutes
  });
  const tokenBudget = lh.tokenBudget;
  const observedTokenUsage = telemetry.observedTokenUsage;
  const remainingTokens = tokenBudget !== null ? tokenBudget - observedTokenUsage : null;

  const isWrapUpRequired = (tokenBudget !== null && remainingTokens !== null && remainingTokens <= 0)
    || telemetry.isApproachingTimeLimit;

  execution.state.dispatchState.budgetTelemetry = {
    tokenBudget,
    observedTokenUsage,
    timeBudgetMinutes: lh.timeBudgetMinutes,
    elapsedSeconds: telemetry.elapsedSeconds,
    remainingSeconds: telemetry.remainingSeconds,
    isWrapUpRequired
  };
}

async function processModelTurnResult(
  execution: AgentExecutionContext,
  step: number,
  response: ModelTurnResponse,
  availability: AgentStepAvailability,
  requireWorkflowToolAction: boolean,
  codeModeTools: FunctionTool[]
): Promise<"continue" | "break"> {
  await updateBudgetTelemetry(execution);
  const dispatchResult = await dispatchResponseOutput(
    response.output,
    buildDispatchContext(execution, codeModeTools),
    execution.state.dispatchState
  );
  if (execution.state.dispatchState.pendingContextV2Reset) {
    await resetV2ContextWindow(execution, "manual");
    return "continue";
  }
  if (await applyPendingContextManagementAction(execution, step)) {
    return "continue";
  }
  if (execution.state.dispatchState.subagentWaitDeadline) return "break";
  if (dispatchResult.finalResponse) {
    if (dispatchResult.finalResponse.partial) {
      return "continue";
    }
    execution.state.finalResponseFromTool = dispatchResult.finalResponse;
    return "break";
  }
  if (dispatchResult.waitRequest) {
    execution.state.waitRequest = dispatchResult.waitRequest;
    return "break";
  }
  if (dispatchResult.stopRequest) {
    execution.state.stopRequest = dispatchResult.stopRequest;
    return "break";
  }
  if (dispatchResult.workflowPause) {
    if (dispatchResult.workflowPause.kind === "long_horizon_clarification_requested") {
      execution.state.workflowAssistantPauseResponse = dispatchResult.workflowPause.response ?? "";
      return "break";
    }
    if (dispatchResult.workflowPause.response) {
      execution.state.workflowAssistantPauseResponse = dispatchResult.workflowPause.response;
    }
    execution.state.workflowPauseRequest = dispatchResult.workflowPause;
    return "break";
  }

  if (response.output_text.trim()) {
    if (!dispatchResult.sawFunctionToolCall) {
      await execution.debugLogger.log("Model turn answered in plain text without a tool call.", {
        stage: "run.turn.plain_text",
        phase: "warn",
        step,
        outputTextLength: response.output_text.trim().length
      });
    }
    handlePlainTextWithoutToolCall(
      execution,
      availability,
      requireWorkflowToolAction,
      dispatchResult.sawFunctionToolCall
    );
    return "continue";
  }

  if (dispatchResult.sawToolCall) {
    return "continue";
  }

  await execution.debugLogger.log("Model turn finished without any actionable output.", {
    stage: "run.turn.no_action",
    phase: "warn",
    step,
    outputTextLength: response.output_text.trim().length,
    outputItemCount: response.output.length,
    outputTypes: summarizeResponseOutputTypes(response),
    allowFinalResponseTool: availability.allowFinalResponseTool,
    allowWaitTool: availability.allowWaitTool,
    requireWorkflowToolAction,
    incompleteReason: response.incomplete_details?.reason ?? null
  });
  if (response.incomplete_details?.reason === "max_output_tokens") {
    execution.state.dispatchState.conversationItems.push({
      role: "user",
      content: "[System: Your previous turn hit the output token limit while reasoning, before it produced any text or tool call. Think briefly and act now.]"
    });
    return "continue";
  }
  return handleNoToolCallFallback(execution, availability);
}

async function runSingleAgentStep(execution: AgentExecutionContext, step: number): Promise<"continue" | "break"> {
  await assertStepNotAborted(execution);

  if (await maybeApplySubscriptionQuota(execution)) {
    return "break";
  }

  const availability = resolveStepAvailability(execution, step);
  await appendSubagentInbox(execution);
  await appendProjectMasterInbox(execution);
  maybeAppendWindingDownNotice(execution, availability);
  await maybeRunAutoCompaction(execution, step);
  const computerAvailability = await appendComputerAvailabilityPrompt(execution);
  const { response, requireWorkflowToolAction, codeModeTools } = await requestModelTurnWithRecovery({
    execution,
    step,
    availability,
    allowComputerLocalShell: computerAvailability.allowComputerLocalShell,
    allowComputerVisualTools: computerAvailability.allowComputerVisualTools
  });

  return processModelTurnResult(execution, step, response, availability, requireWorkflowToolAction, codeModeTools);
}

function handleStepError(execution: AgentExecutionContext, error: unknown): "continue" | "break" | "throw" {
  if (execution.prepared.cancellationMonitor.signal.aborted || (error instanceof Error && error.message === "TASK_CANCELLED")) {
    return "throw";
  }
  if (execution.runControl.runTimedOut && execution.runControl.isTimedInfiniteRun) {
    if (!execution.runControl.timedRunFinalizing) {
      execution.runControl.timedRunFinalizing = true;
      execution.injectTimedRunFinalizationPrompt();
      return "continue";
    }

    execution.state.finalResponseFromTool = {
      response: "Timed task reached its time limit and could not produce a final response before stopping.",
      notify: true
    };
    return "break";
  }

  return "throw";
}

export async function runAgentStepLoop(execution: AgentExecutionContext): Promise<void> {
  execution.state.contextManagement ??= { version: "v1" };
  let reachedMaxRunSteps = true;

  for (let step = 0; step < execution.maxRunSteps; step += 1) {
    try {
      const action = await runSingleAgentStep(execution, step);
      if (action === "break") {
        reachedMaxRunSteps = false;
        break;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "RUN_TIME_LIMIT_REACHED") {
        execution.runControl.runTimedOut = true;
      }
      const timedAction = handleStepError(execution, error);
      if (timedAction === "continue") {
        continue;
      }
      reachedMaxRunSteps = false;
      if (timedAction === "break") {
        break;
      }
      throw error;
    }
  }

  execution.runControl.reachedMaxRunSteps = reachedMaxRunSteps;
  if (reachedMaxRunSteps) {
    await execution.debugLogger.log("Run exhausted its reasoning step budget without a terminal tool call.", {
      stage: "run.max_steps",
      phase: "warn",
      maxRunSteps: execution.maxRunSteps,
      workflowType: execution.workflow.workflowContext?.workflowType ?? null,
      mode: execution.job.mode ?? "default"
    });
  }
  if (!execution.runControl.runTimedOut) {
    await execution.assertRunNotAborted();
  }
}
