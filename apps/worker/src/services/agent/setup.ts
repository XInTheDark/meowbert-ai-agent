import { prepareConversationOrganization, conversationOrganizationPrompt } from "./conversation-organization.js";
import { buildSubagentPrompt } from "../subagents/prompt.js";
import { buildProjectMasterPrompt } from "../project-master/prompt.js";
import { getPersistentRuntimeEnabled } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { setTaskStatusForRun } from "../agent-db/index.js";
import { asText, mapMessagesForResponsesInput } from "./utils.js";
import { buildSystemPrompt } from "./prompt.js";
import { maybeAutoGenerateTaskTitle } from "./model.js";
import { resolveRunUsageBilling } from "./usage-billing.js";
import {
  getMessagesAfterLatestCompaction,
  getMessagesForV2ActiveWindow,
  getVisibleMessagesForContextClear,
} from "../context-compaction/index.js";
import {
  buildV2WindowDeveloperItems,
  CONTEXT_WINDOW_GUIDANCE,
  resolveFrozenContextManagementVersion,
  resolveContextManagementState
} from "../context-management-v2/index.js";
import { appendPromptEnvelopeDelta, createPromptEnvelope } from "./prompt-envelope.js";
import {
  ensureRecurringTaskStateFile,
  getTaskScheduleInfo
} from "../task-schedules/service.js";
import { enableRunCapabilities, resolveOnDemandCapabilities } from "./run-capabilities.js";
import { TASK_SCHEDULING_TOOL_GROUP_ID, withToolGroups } from "../agent-tools/index.js";
import { resolveAgentTaskInputDir } from "./task-input-dir.js";
import {
  buildWorkflowPromptContext,
  clearSwarmPauseOnRunStart,
  shouldAllowSwarmChannelTools,
  shouldAllowWorkflowFinalResponse,
  shouldAllowWorkflowRequestClarification,
  shouldAllowWorkflowStartLongHorizon,
  shouldAllowWorkflowSubmitResponse,
  shouldAllowWorkflowSubmitReview,
  requiresSwarmFinalReview,
  resolveAgentSwarmReviewRounds,
  loadWorkflowRunContext
} from "../task-workflows/service.js";
import { hasSwarmLeadership } from "../task-workflows/swarm-target.js";
import { shouldExposeStopTaskForRecurringRun } from "../tasks/recurring-run-utils.js";
import { resolveWorkflowWritableSharedPaths } from "./task-write-scope.js";
import { loadProjectContextPromptData } from "./project-context.js";
import type { AgentExecutionContext, AgentRunControlState, WorkflowCapabilityState } from "./execution-types.js";
import type { PreparedAgentRunContext } from "./runtime.js";
import { isTaskDebugModeEnabled, type TaskDebugLogger } from "../runtime/debug-task-events.js";

async function inspectProjectContextDirectory(envRoot: string): Promise<Record<string, unknown>> {
  const resolvedEnvRoot = path.resolve(envRoot);
  const envRootRealPath = await fsPromises.realpath(resolvedEnvRoot).catch(() => null);
  const envRootEntries = await fsPromises.readdir(resolvedEnvRoot).catch(() => []);
  const contextPath = path.resolve(resolvedEnvRoot, "context");
  const contextStats = await fsPromises.lstat(contextPath).catch(() => null);
  const contextEntries = contextStats?.isDirectory()
    ? await fsPromises.readdir(contextPath).catch(() => [])
    : [];

  return {
    envRoot: resolvedEnvRoot,
    envRootRealPath,
    envRootEntryCount: envRootEntries.length,
    envRootEntrySample: envRootEntries.slice(0, 20),
    contextPath,
    contextExists: contextStats !== null,
    contextIsDirectory: contextStats?.isDirectory() ?? false,
    contextEntryCount: contextEntries.length,
    contextEntrySample: contextEntries.slice(0, 20)
  };
}

async function loadProjectContextInitData(
  envRoot: string,
  envPayload: Record<string, unknown>
): Promise<{
  projectContext: Awaited<ReturnType<typeof loadProjectContextPromptData>>;
  inspection: Record<string, unknown>;
}> {
  // The directory listing only feeds the debug log, and project storage can be a network mount.
  const [projectContext, inspection] = await Promise.all([
    loadProjectContextPromptData(envRoot, envPayload),
    isTaskDebugModeEnabled().then((enabled) => enabled ? inspectProjectContextDirectory(envRoot) : {})
  ]);

  return {
    projectContext,
    inspection
  };
}

function startTitleGeneration(job: AgentExecutionContext["job"], prepared: PreparedAgentRunContext): void {
  maybeAutoGenerateTaskTitle({
    provider: prepared.runtimeProvider,
    billing: resolveRunUsageBilling({ prepared, job }),
    taskId: job.taskId,
    currentTitle: prepared.snapshot.task.title,
    source: prepared.snapshot.task.source,
    messages: prepared.snapshot.messages,
    taskInputDir: resolveAgentTaskInputDir({ taskDir: prepared.taskDir }),
    memoryMainFile: prepared.memoryMainFile,
    projectMemoryMainFile: prepared.projectMemoryMainFile,
    imageDetail: prepared.snapshot.image_detail ?? "high",
    model: prepared.runtimeQuickModel,
    compatibilityModes: prepared.runtimeQuickModelCompatibilityModes,
    requestTimeoutMs: prepared.snapshot.model_request_timeout_ms,
    abortSignal: prepared.cancellationMonitor.signal,
    onNetworkRequest: prepared.emitNetworkRequestLog
  }).catch(() => {});
}

function createRunControl(
  job: AgentExecutionContext["job"],
  prepared: PreparedAgentRunContext,
  scheduleInfo: AgentExecutionContext["scheduleInfo"]
): AgentRunControlState {
  const isTimedInfiniteRun =
    job.mode === "infinite_auto"
    && scheduleInfo?.mode === "infinite"
    && typeof scheduleInfo.runTimeoutSeconds === "number"
    && scheduleInfo.runTimeoutSeconds > 0;
  const runDeadlineAtMs = isTimedInfiniteRun
    ? (
      scheduleInfo?.runDeadlineAt
        ? new Date(scheduleInfo.runDeadlineAt).getTime()
        : prepared.runStartedAt.getTime() + (scheduleInfo.runTimeoutSeconds ?? 0) * 1000
    )
    : null;
  const runTimeLimitController = isTimedInfiniteRun ? new AbortController() : null;
  const runTimeLimitTimer = runTimeLimitController && runDeadlineAtMs !== null
    ? setTimeout(() => {
      if (!runTimeLimitController.signal.aborted) {
        runTimeLimitController.abort(new Error("RUN_TIME_LIMIT_REACHED"));
      }
    }, Math.max(0, runDeadlineAtMs - Date.now()))
    : null;

  return {
    isTimedInfiniteRun,
    runDeadlineAtMs,
    runTimedOut: false,
    reachedMaxRunSteps: false,
    timedRunFinalizing: false,
    timedRunFinalizationPromptInjected: false,
    runTimeLimitController,
    runTimeLimitTimer,
    runAbortSignal: runTimeLimitController
      ? AbortSignal.any([prepared.cancellationMonitor.signal, runTimeLimitController.signal])
      : prepared.cancellationMonitor.signal
  };
}

function createRunAbortAsserter(prepared: PreparedAgentRunContext, runControl: AgentRunControlState): () => Promise<void> {
  return async (): Promise<void> => {
    if (runControl.isTimedInfiniteRun && runControl.runDeadlineAtMs !== null && Date.now() >= runControl.runDeadlineAtMs) {
      runControl.runTimedOut = true;
      if (runControl.runTimeLimitController && !runControl.runTimeLimitController.signal.aborted) {
        runControl.runTimeLimitController.abort(new Error("RUN_TIME_LIMIT_REACHED"));
      }
      throw new Error("RUN_TIME_LIMIT_REACHED");
    }
    await prepared.cancellationMonitor.assertNotCancelled();
  };
}

function resolveRecurringStateFilePath(input: {
  prepared: PreparedAgentRunContext;
  scheduleInfo: AgentExecutionContext["scheduleInfo"];
  envRoot: string;
}): string | null {
  if (!input.scheduleInfo) {
    return null;
  }

  const objectiveMessage = input.prepared.snapshot.messages.find((message) => message.role === "user");
  return ensureRecurringTaskStateFile({
    taskRootPath: input.prepared.snapshot.task.task_root_path,
    envRoot: input.envRoot,
    schedule: input.scheduleInfo,
    objective: objectiveMessage ? asText(objectiveMessage.content_json) : (input.prepared.snapshot.task.title ?? "")
  });
}

async function resolveWorkflowCapabilities(
  job: AgentExecutionContext["job"],
  prepared: PreparedAgentRunContext
): Promise<WorkflowCapabilityState> {
  const workflowContext = await loadWorkflowRunContext({
    taskId: job.taskId,
    envRoot: prepared.envRoot,
    workspaceId: prepared.snapshot.task.workspace_id
  });

  return {
    workflowContext,
    workflowPromptContext: workflowContext ? buildWorkflowPromptContext(workflowContext, job.mode ?? "default") : null,
    allowWorkflowFinalResponse: shouldAllowWorkflowFinalResponse(workflowContext, job.mode ?? "default"),
    allowWorkflowStartLongHorizon: shouldAllowWorkflowStartLongHorizon(workflowContext, job.mode ?? "default"),
    allowWorkflowRequestClarification: shouldAllowWorkflowRequestClarification(workflowContext, job.mode ?? "default"),
    allowWorkflowSubmitResponse: shouldAllowWorkflowSubmitResponse(workflowContext, job.mode ?? "default"),
    allowWorkflowSubmitReview: shouldAllowWorkflowSubmitReview(workflowContext, job.mode ?? "default"),
    allowSwarmTools: shouldAllowSwarmChannelTools(workflowContext)
  };
}

function buildRunSystemPrompt(input: {
  job: AgentExecutionContext["job"];
  prepared: PreparedAgentRunContext;
  taskInputDir: string;
  recurringStateFilePath: string | null;
  allowScheduleTools: boolean;
  allowSubtaskTools: boolean;
  allowStopTask: boolean;
  scheduleInfo: AgentExecutionContext["scheduleInfo"];
  workflow: WorkflowCapabilityState;
  projectContextPromptData: Awaited<ReturnType<typeof loadProjectContextPromptData>>;
}): string {
  const allowFinalResponseInPrompt = input.workflow.workflowContext
    ? input.workflow.allowWorkflowFinalResponse
    : input.job.mode !== "infinite_auto";
  const allowWaitInPrompt = input.prepared.snapshot.task.allow_waiting !== false
    && (!input.workflow.workflowContext || (
      input.workflow.workflowContext.workflowType === "agent_swarm"
      && getPersistentRuntimeEnabled(input.prepared.runtimeEnvironmentPayload)
    ));
  const allowSwarmPauseInPrompt = input.workflow.workflowContext
    ? input.workflow.workflowContext.workflowType === "agent_swarm"
    : false;
  const interactiveCanvas = input.prepared.snapshot.interactive_canvas;

  const prompt = buildSystemPrompt(
    input.prepared.taskDir,
    input.prepared.envRoot,
    input.prepared.workspaceRoot,
    input.prepared.runtimeEnvironmentPayload,
    {
      triggerSource: input.prepared.snapshot.task.source,
      memoryEnabled: input.prepared.memoryEnabled,
      thoughtPersistenceEnabled: input.prepared.thoughtPersistenceEnabled,
      memoryMainFilePath: input.prepared.memoryMainFile?.path ?? null,
      memoryMainFileContent: input.prepared.memoryMainFile?.content ?? null,
      memoryMainFileTruncated: input.prepared.memoryMainFile?.truncated ?? false,
      projectMemoryMainFilePath: input.prepared.projectMemoryMainFile?.path ?? null,
      projectMemoryMainFileContent: input.prepared.projectMemoryMainFile?.content ?? null,
      projectMemoryMainFileTruncated: input.prepared.projectMemoryMainFile?.truncated ?? false,
      allowFinalResponse: allowFinalResponseInPrompt,
      allowStopTask: input.allowStopTask,
      allowWaitTool: allowWaitInPrompt,
      persistentRuntimeEnabled: getPersistentRuntimeEnabled(input.prepared.runtimeEnvironmentPayload),
      allowSwarmPauseTool: allowSwarmPauseInPrompt,
      allowSwarmManageTool: input.workflow.allowSwarmTools
        && Boolean(input.workflow.workflowContext && hasSwarmLeadership(input.workflow.workflowContext)),
      allowSwarmReviewTool: input.workflow.workflowContext?.workflowType === "agent_swarm"
        && input.workflow.workflowContext.currentAgent?.role === "leader"
        && input.workflow.allowSwarmTools
        && (input.workflow.workflowContext.swarm?.completedReviewRounds ?? 0)
          < resolveAgentSwarmReviewRounds(input.workflow.workflowContext),
      allowSwarmFinalReviewTool: input.workflow.workflowContext?.workflowType === "agent_swarm"
        && input.workflow.workflowContext.currentAgent?.role === "leader"
        && input.workflow.allowSwarmTools
        && requiresSwarmFinalReview(input.workflow.workflowContext)
        && !input.workflow.workflowContext.swarm?.finalReview?.approved,
      allowSwarmOutputTool: input.workflow.workflowContext?.workflowType === "agent_swarm"
        && input.workflow.allowSwarmTools
        && Array.isArray(input.workflow.workflowContext.currentAgent?.state_json?.swarmLeaderNodeIds)
        && input.workflow.workflowContext.currentAgent!.state_json.swarmLeaderNodeIds.some((nodeId) => nodeId !== "node-0"),
      qualityReviewSpecialist: input.prepared.isQualityReviewSpecialist,
      allowScheduleTools: input.allowScheduleTools,
      allowSubtaskTools: input.allowSubtaskTools,
      allowComputerUse: input.prepared.runToolOptions.computerUse === true,
      allowPdfFileTool: !input.prepared.runtimeCompatibilityModes.includes("disablePdfFile"),
      allowMemorySearch: input.prepared.runToolOptions.memorySearch === true,
      allowTaskHistoryTools: input.prepared.memoryEnabled || input.prepared.isProjectMaster === true,
      allowLiveSyncTools: input.prepared.liveSyncFiles.length > 0,
      allowInteractiveCanvasTools: input.prepared.snapshot.task.is_thread !== true,
      taskFilesystemReadOnly: input.prepared.snapshot.task.is_thread,
      taskInputDir: input.taskInputDir,
      liveSyncFiles: input.prepared.liveSyncFiles,
      writableSharedPaths: resolveWorkflowWritableSharedPaths(input.workflow.workflowContext),
      recurringStateFilePath: input.recurringStateFilePath,
      recurringSchedule: input.scheduleInfo
        ? {
            mode: input.scheduleInfo.mode,
            scheduleState: input.scheduleInfo.scheduleState,
            repeat: input.scheduleInfo.repeat,
            timezone: input.scheduleInfo.timezone,
            nextRunAt: input.scheduleInfo.nextRunAt,
            runTimeoutSeconds: input.scheduleInfo.runTimeoutSeconds
          }
        : null,
      githubIntegration: input.prepared.snapshot.github_connection
        ? {
            login: input.prepared.snapshot.github_connection.type === "app"
              ? input.prepared.snapshot.github_connection.app_slug
              : input.prepared.snapshot.github_connection.github_login,
            defaultOrg: input.prepared.snapshot.github_connection.default_org,
            contentsPermission: input.prepared.githubInstallationAccess?.contentsPermission ?? null,
            repositorySelection: input.prepared.githubInstallationAccess?.repositorySelection ?? null,
            canReadContents: input.prepared.githubInstallationAccess?.canReadContents,
            canWriteContents: input.prepared.githubInstallationAccess?.canWriteContents
          }
        : null,
      allowRefreshGitHubToken: input.prepared.hasGitHubAppConnection,
      workflow: input.workflow.workflowPromptContext
        ? {
            workflowType: input.workflow.workflowContext!.workflowType,
            roleSummary: input.workflow.workflowPromptContext.roleSummary,
            section: input.workflow.workflowPromptContext.section,
            embeddedPersonalityIds: input.workflow.workflowPromptContext.embeddedPersonalityIds,
            allowStartLongHorizonTask: input.workflow.allowWorkflowStartLongHorizon,
            allowRequestClarification: input.workflow.allowWorkflowRequestClarification,
            allowSubmitResponse: input.workflow.allowWorkflowSubmitResponse,
            allowSubmitReview: input.workflow.allowWorkflowSubmitReview,
            allowSwarmTools: input.workflow.allowSwarmTools
          }
        : null,
      projectContext: input.projectContextPromptData,
      interactiveCanvas: interactiveCanvas
        ? {
            id: interactiveCanvas.id,
            name: interactiveCanvas.name,
            rootPath: interactiveCanvas.root_path,
            entryPath: interactiveCanvas.entry_path,
            runtimeMode: interactiveCanvas.runtime_mode,
            absolutePath: path.resolve(input.prepared.envRoot, interactiveCanvas.root_path),
            intent: input.prepared.snapshot.task.interactive_canvas_intent
          }
        : null
    }
  );
  return input.allowSubtaskTools ? `${prompt}\n\n${buildSubagentPrompt({
    taskId: input.job.taskId, parentId: input.prepared.snapshot.task.parent_task_id,
    depth: input.prepared.snapshot.task.subtask_depth
  })}` : prompt;
}

function buildQuickModeSystemPrompt(isProjectMaster: boolean): string {
  return [
    "You are ChatGPT in Quick mode.",
    "Answer the user directly without using workspace tools, shell commands, file access, browser tools, or sandbox-only capabilities.",
    ...(isProjectMaster ? [] : ["If the request needs project files, uploaded non-image attachments, command execution, code edits, external tools, or persistent workspace context, call `init_sandbox` first."]),
    "Tool results include a `context` string with exact API-reported input-token usage for the model request that produced the tool call. It is one request behind and excludes the current response and tool result.",
    "Images that were attached by the user may already be included in the conversation. Other uploaded files become accessible after `init_sandbox`."
  ].join("\n");
}

export async function initializeAgentExecution(
  job: AgentExecutionContext["job"],
  prepared: PreparedAgentRunContext,
  debugLogger: TaskDebugLogger
): Promise<AgentExecutionContext> {
  await prepared.cancellationMonitor.assertNotCancelled();
  startTitleGeneration(job, prepared);
  await debugLogger.log("Started background task title generation.", {
    stage: "init.title_generation",
    phase: "start"
  });
  if (!(await setTaskStatusForRun(job.taskId, job.runId, "running"))) {
    throw new Error("TASK_CANCELLED");
  }
  await debugLogger.log("Task status set to running.", {
    stage: "init.status",
    phase: "success",
    status: "running"
  });
  if (job.mode === "agent_swarm_leader" || job.mode === "agent_swarm_worker") {
    await clearSwarmPauseOnRunStart(job.taskId);
    await debugLogger.log("Cleared stale swarm pause state.", {
      stage: "init.swarm_pause",
      phase: "success"
    });
  }

  const scheduleInfo = await debugLogger.stage({
    stage: "init.schedule",
    startMessage: "Loading task schedule state.",
    successMessage: (resolvedSchedule) => resolvedSchedule
      ? "Loaded task schedule state."
      : "No task schedule state configured.",
    run: () => getTaskScheduleInfo(job.taskId),
    successPayload: (resolvedSchedule) => ({
      hasSchedule: resolvedSchedule !== null,
      scheduleMode: resolvedSchedule?.mode ?? null,
      scheduleState: resolvedSchedule?.scheduleState ?? null
    })
  });
  const runControl = createRunControl(job, prepared, scheduleInfo);
  const allowScheduleTools = prepared.snapshot.task.is_thread !== true && prepared.runToolOptions.scheduleTask === true;
  // A task that already has a schedule keeps its scheduling tools loaded; others load them on demand.
  const loadedToolGroups = new Set<string>(allowScheduleTools && scheduleInfo !== null ? [TASK_SCHEDULING_TOOL_GROUP_ID] : []);
  const onDemandCapabilities = resolveOnDemandCapabilities(
    prepared,
    allowScheduleTools && scheduleInfo === null ? [TASK_SCHEDULING_TOOL_GROUP_ID] : []
  );
  const enableSkillById = withToolGroups(prepared.enableSkillById, allowScheduleTools ? [TASK_SCHEDULING_TOOL_GROUP_ID] : [], loadedToolGroups);
  const allowSubtaskTools = prepared.snapshot.task.is_thread !== true && prepared.runToolOptions.subtasks === true;
  const allowStopTask = shouldExposeStopTaskForRecurringRun({
    hasSchedule: scheduleInfo !== null,
    scheduleState: scheduleInfo?.scheduleState ?? null,
    isTimedInfiniteRun: runControl.isTimedInfiniteRun
  });
  const maxRunSteps = Math.min(config.runtime.maxSteps, prepared.snapshot.task.max_steps_override ?? config.runtime.maxSteps);
  const recurringStateFilePath = resolveRecurringStateFilePath({
    prepared,
    scheduleInfo,
    envRoot: prepared.envRoot
  });
  const workflow = await debugLogger.stage({
    stage: "init.workflow",
    startMessage: "Resolving workflow capabilities.",
    successMessage: "Resolved workflow capabilities.",
    run: () => resolveWorkflowCapabilities(job, prepared),
    successPayload: (resolvedWorkflow) => ({
      workflowType: resolvedWorkflow.workflowContext?.workflowType ?? null,
      allowWorkflowFinalResponse: resolvedWorkflow.allowWorkflowFinalResponse,
      allowWorkflowStartLongHorizon: resolvedWorkflow.allowWorkflowStartLongHorizon,
      allowWorkflowRequestClarification: resolvedWorkflow.allowWorkflowRequestClarification,
      allowWorkflowSubmitResponse: resolvedWorkflow.allowWorkflowSubmitResponse,
      allowWorkflowSubmitReview: resolvedWorkflow.allowWorkflowSubmitReview,
      allowSwarmTools: resolvedWorkflow.allowSwarmTools
    })
  });
  const taskInputDir = resolveAgentTaskInputDir({
    taskDir: prepared.taskDir,
    workflowTaskDir: workflow.workflowContext?.workflowTaskDir
  });
  prepared.shellEnvOverrides.TASK_INPUT_DIR = taskInputDir;
  const frozenContextManagementVersion = await resolveFrozenContextManagementVersion({
    taskId: job.taskId,
    requestedVersion: prepared.requestedContextManagementVersion,
    runtimeModel: prepared.runtimeModel
  });
  const isManualClear = job.mode === "compact_only" && job.contextAction === "clear";
  const activeContextMessages = isManualClear
    ? getVisibleMessagesForContextClear(prepared.snapshot.messages)
    : frozenContextManagementVersion === "v2"
      ? getMessagesForV2ActiveWindow(prepared.snapshot.messages)
      : getMessagesAfterLatestCompaction(prepared.snapshot.messages);
  const mappedConversationItems = await mapMessagesForResponsesInput(
    activeContextMessages,
    taskInputDir,
    prepared.snapshot.image_detail ?? "high",
    {
      quickMode: prepared.quickMode,
      sendMetadataToModel: prepared.snapshot.send_metadata_to_model
    }
  );
  const resolvedContextManagement = await resolveContextManagementState({
    taskId: job.taskId,
    requestedVersion: frozenContextManagementVersion,
    runtimeModel: prepared.runtimeModel,
    branchLeafMessageId: prepared.snapshot.branch_leaf_message_id,
    seedItems: isManualClear ? [] : mappedConversationItems,
    skipHistoryReplay: isManualClear
  });
  const conversationItems = resolvedContextManagement.conversationItems;
  await prepared.cancellationMonitor.assertNotCancelled();

  const projectContextInitData = await debugLogger.stage({
    stage: "init.project_context",
    startMessage: "Loading project context prompt data.",
    successMessage: (result) => result.projectContext
      ? "Loaded project context prompt data."
      : "No project context prompt data found.",
    run: () => loadProjectContextInitData(
      prepared.envRoot,
      prepared.runtimeEnvironmentPayload
    ),
    successPayload: (result) => ({
      hasProjectContext: result.projectContext !== null,
      entryCount: result.projectContext?.entries.length ?? 0,
      ...(result.inspection)
    })
  });
  const projectContextPromptData = projectContextInitData.projectContext;
  const fullSystemPrompt = buildRunSystemPrompt({
    job,
    prepared,
    taskInputDir,
    recurringStateFilePath,
    allowScheduleTools,
    allowSubtaskTools,
    allowStopTask,
    workflow,
    scheduleInfo,
    projectContextPromptData
  });
  const systemPrompt = prepared.quickMode ? buildQuickModeSystemPrompt(prepared.isProjectMaster === true) : fullSystemPrompt;
  let activeSystemPrompt = systemPrompt;
  await debugLogger.log("Built system prompt.", {
    stage: "init.system_prompt",
    phase: "success",
    promptLength: systemPrompt.length
  });
  const organization = await prepareConversationOrganization(prepared, job);
  const promptEnvelope = createPromptEnvelope(systemPrompt);
  if (organization) appendPromptEnvelopeDelta(promptEnvelope, { reason: "conversation-organization", content: conversationOrganizationPrompt(organization) });
  if (prepared.isProjectMaster) appendPromptEnvelopeDelta(promptEnvelope, { reason: "project-master", content: buildProjectMasterPrompt() });
  if (resolvedContextManagement.state.version === "v2") {
    conversationItems.unshift(
      ...(await buildV2WindowDeveloperItems({
        state: resolvedContextManagement.state,
        agentName: prepared.runtimeAgentId ?? "main"
      })),
      { role: "developer", content: CONTEXT_WINDOW_GUIDANCE }
    );
  }
  if (!prepared.quickMode) {
    await debugLogger.stage({
      stage: "init.auto_enable",
      startMessage: "Auto-enabling selected skills and sources.",
      successMessage: "Auto-enabled selected skills and sources.",
      run: () => enableRunCapabilities({ prepared, promptEnvelope, enableSkillById, onDemandCapabilities, conversationItems }),
      successPayload: {
        enabledSkillCount: prepared.runToolOptions.enabledSkills.length,
        enabledSourceCount: prepared.runToolOptions.enabledSources.length
      }
    });
  }

  const state = {
    contextManagement: resolvedContextManagement.state,
    currentLeafMessageId: prepared.currentLeafMessageId,
    dispatchState: {
      organization,
      conversationItems,
      runPersistedItems: prepared.runPersistedItems,
      contextUsage: null,
      commandStep: 0,
      finalResponseSegments: []
    },
    shouldRecordTokenUsage: false,
    hasActualContextUsage: false,
    lastActualContextUsage: null,
    finalResponseFromTool: null,
    waitRequest: null,
    stopRequest: null,
    workflowPauseRequest: null,
    workflowAssistantPauseResponse: null,
    notificationRequested: true,
    quickModeActive: prepared.quickMode
  };

  const assertRunNotAborted = createRunAbortAsserter(prepared, runControl);
  const injectTimedRunFinalizationPrompt = (): void => {
    if (runControl.timedRunFinalizationPromptInjected) {
      return;
    }
    appendPromptEnvelopeDelta(promptEnvelope, {
      reason: "timed-run-finalizing",
      role: "system",
      runScoped: true,
      content: [
        "The timed task's deadline has been reached.",
        "This is the final wrap-up turn.",
        "Do not continue the recurring loop.",
        "`final_response` is now available.",
        "`wait` and `stop_task` are unavailable."
      ].join(" ")
    });
    runControl.timedRunFinalizationPromptInjected = true;
  };
  let executionContext: AgentExecutionContext | null = null;
  const initializeQuickModeSandbox = async (): Promise<{ alreadyInitialized: boolean }> => {
    const initialized = await prepared.initializeSandbox();
    if (state.quickModeActive) {
      appendPromptEnvelopeDelta(promptEnvelope, {
        reason: "quick-mode-sandbox-initialized",
        role: "system",
        runScoped: true,
        content: [
          "Quick mode has ended. The sandbox and full task tools are now available.",
          "Follow this task system prompt for the rest of the run:",
          fullSystemPrompt
        ].join("\n\n")
      });
      await enableRunCapabilities({
        prepared,
        promptEnvelope,
        enableSkillById,
        onDemandCapabilities,
        conversationItems: state.dispatchState.conversationItems
      });
      activeSystemPrompt = fullSystemPrompt;
      if (executionContext) {
        executionContext.systemPrompt = activeSystemPrompt;
      }
      state.quickModeActive = false;
    }
    return initialized;
  };

  await debugLogger.log("Agent execution context initialized.", {
    stage: "init.complete",
    phase: "success",
    maxRunSteps,
    conversationItemCount: conversationItems.length
  });

  executionContext = {
    job,
    prepared,
    manualClearItems: isManualClear ? mappedConversationItems : null,
    debugLogger,
    taskInputDir,
    scheduleInfo,
    allowScheduleTools,
    loadedToolGroups,
    enableSkillById,
    onDemandCapabilities,
    allowSubtaskTools,
    allowStopTask,
    maxRunSteps,
    recurringStateFilePath,
    workflow,
    systemPrompt: activeSystemPrompt,
    promptEnvelope,
    runControl,
    state,
    assertRunNotAborted,
    injectTimedRunFinalizationPrompt,
    initializeQuickModeSandbox
  };
  return executionContext;
}
