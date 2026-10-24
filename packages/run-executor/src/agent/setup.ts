import { prepareConversationOrganization, conversationOrganizationPrompt } from "./conversation-organization.js";
import { buildSubagentPrompt } from "../subagents/prompt.js";
import { buildProjectMasterPrompt } from "../project-master/prompt.js";
import { getPersistentRuntimeEnabled, WORKSPACE_DEFAULT_TOOLSET_CANVAS_SKILL_ID as CANVAS_SKILL_ID } from "@meowbert/shared";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { asText, mapMessagesForResponsesInput } from "./utils.js";
import { buildSystemPrompt } from "./prompt.js";
import { toSandboxText } from "@meowbert/shared/docker-sandbox";
import { maybeAutoGenerateTaskTitle } from "./model.js";
import {
  getMessagesAfterLatestCompaction,
  getMessagesForV2ActiveWindow,
  getVisibleMessagesForContextClear,
} from "../context-compaction/index.js";
import { CONTEXT_WINDOW_GUIDANCE } from "../context-management-v2/prompts.js";
import { buildV2WindowDeveloperItems, resolveContextManagementState } from "../context-management-v2/window.js";
import { appendPromptEnvelopeDelta, createPromptEnvelope } from "./prompt-envelope.js";
import { ensureRecurringTaskStateFile } from "./recurring-state-file.js";
import { enableRunCapabilities, resolveOnDemandCapabilities } from "./run-capabilities.js";
import { TASK_SCHEDULING_TOOL_GROUP_ID, withToolGroups } from "../agent-tools/index.js";
import { resolveAgentTaskInputDir } from "./task-input-dir.js";
import {
  buildWorkflowPromptContext,
  shouldAllowWorkflowFinalResponse,
  shouldAllowWorkflowRequestClarification,
  shouldAllowWorkflowStartLongHorizon,
  shouldAllowWorkflowSubmitResponse,
  shouldAllowWorkflowSubmitReview
} from "../task-workflows/prompts.js";
import { shouldExposeStopTaskForRecurringRun } from "../tasks/recurring-run-utils.js";
import { loadProjectContextPromptData } from "./project-context.js";
import type { AgentExecutionContext, AgentRunTimingState, WorkflowCapabilityState } from "./execution-types.js";
import type { PreparedAgentRunContext } from "./runtime.js";
import type { TaskDebugLogger } from "./run-debug-logger.js";
import type { SwarmRunContext } from "../agent-swarm/run-context.js";
import { loadCheckPrompt, loadSwarmGuide } from "../agent-swarm/prompt.js";
import { resolveLaneMaxSteps } from "../agent-swarm/forced-submit.js";
import type { ContextManagementState } from "../context-management-v2/types.js";
import { reportInterruptedToolCalls } from "./interrupted-tool-calls.js";
import type { ResponseInputItem } from "openai/resources/responses/responses";

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
  envPayload: Record<string, unknown>,
  isDebugEnabled: () => Promise<boolean>
): Promise<{
  projectContext: Awaited<ReturnType<typeof loadProjectContextPromptData>>;
  inspection: Record<string, unknown>;
}> {
  // The directory listing only feeds the debug log, and project storage can be a network mount.
  const [projectContext, inspection] = await Promise.all([
    loadProjectContextPromptData(envRoot, envPayload),
    isDebugEnabled().then((enabled) => enabled ? inspectProjectContextDirectory(envRoot) : {})
  ]);

  return {
    projectContext,
    inspection
  };
}

function startTitleGeneration(job: AgentExecutionContext["job"], prepared: PreparedAgentRunContext): void {
  maybeAutoGenerateTaskTitle({
    control: prepared.control,
    models: prepared.models,
    chatGptCodex: prepared.chatGptCodex,
    taskId: job.taskId,
    currentTitle: prepared.snapshot.task.title,
    source: prepared.snapshot.task.source,
    messages: prepared.snapshot.messages,
    taskInputDir: resolveAgentTaskInputDir({ taskDir: prepared.taskDir }),
    memoryMainFile: prepared.memoryMainFile,
    projectMemoryMainFile: prepared.projectMemoryMainFile,
    imageDetail: prepared.snapshot.image_detail ?? "high",
    compatibilityModes: prepared.runtimeQuickModelCompatibilityModes,
    requestTimeoutMs: prepared.snapshot.model_request_timeout_ms,
    abortSignal: prepared.cancellationMonitor.signal
  }).catch(() => {});
}

function createRunTiming(
  job: AgentExecutionContext["job"],
  prepared: PreparedAgentRunContext,
  scheduleInfo: AgentExecutionContext["scheduleInfo"]
): AgentRunTimingState {
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

function createRunAbortAsserter(prepared: PreparedAgentRunContext, runTiming: AgentRunTimingState): () => Promise<void> {
  return async (): Promise<void> => {
    if (runTiming.isTimedInfiniteRun && runTiming.runDeadlineAtMs !== null && Date.now() >= runTiming.runDeadlineAtMs) {
      runTiming.runTimedOut = true;
      if (runTiming.runTimeLimitController && !runTiming.runTimeLimitController.signal.aborted) {
        runTiming.runTimeLimitController.abort(new Error("RUN_TIME_LIMIT_REACHED"));
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
  const workflowContext = await prepared.features.loadWorkflow({
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
    allowWorkflowSubmitReview: shouldAllowWorkflowSubmitReview(workflowContext, job.mode ?? "default")
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
    && !input.workflow.workflowContext;
  const interactiveCanvas = input.prepared.snapshot.interactive_canvas;

  const prompt = buildSystemPrompt(
    input.prepared.taskDir,
    input.prepared.envRoot,
    input.prepared.workspaceRoot,
    input.prepared.runtimeEnvironmentPayload,
    {
      sharedDependenciesDirectory: input.prepared.settings.sharedDependenciesDirectory,
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
      qualityReviewSpecialist: input.prepared.isQualityReviewSpecialist,
      allowScheduleTools: input.allowScheduleTools,
      allowSubtaskTools: input.allowSubtaskTools,
      allowComputerUse: input.prepared.runToolOptions.computerUse === true,
      allowPdfFileTool: !input.prepared.runtimeCompatibilityModes.includes("disablePdfFile"),
      allowMemorySearch: input.prepared.runToolOptions.memorySearch === true,
      allowTaskHistoryTools: input.prepared.memoryEnabled || input.prepared.isProjectMaster === true,
      allowLiveSyncTools: input.prepared.liveSyncFiles.length > 0,
      allowCanvasTools: input.prepared.snapshot.task.is_thread !== true
        && input.prepared.runToolOptions.enabledSkills.includes(CANVAS_SKILL_ID),
      taskFilesystemReadOnly: input.prepared.snapshot.task.is_thread,
      taskInputDir: input.taskInputDir,
      liveSyncFiles: input.prepared.liveSyncFiles,
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
            allowSubmitReview: input.workflow.allowWorkflowSubmitReview
          }
        : null,
      projectContext: input.projectContextPromptData,
      interactiveCanvas: interactiveCanvas
        ? {
            id: interactiveCanvas.id,
            name: interactiveCanvas.name,
            rootPath: interactiveCanvas.root_path,
            entryPath: interactiveCanvas.entry_path,
            absolutePath: path.resolve(input.prepared.envRoot, interactiveCanvas.root_path)
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

async function resolveRunConversation(input: {
  job: AgentExecutionContext["job"];
  prepared: PreparedAgentRunContext;
  taskInputDir: string;
  isManualClear: boolean;
}): Promise<{
  mappedConversationItems: ResponseInputItem[];
  resolvedContextManagement: { state: ContextManagementState; conversationItems: ResponseInputItem[] };
}> {
  const { job, prepared, isManualClear } = input;
  const frozenContextManagementVersion = await prepared.control.context.freezeVersion(
    prepared.requestedContextManagementVersion,
    prepared.runtimeModel
  );
  const activeContextMessages = isManualClear
    ? getVisibleMessagesForContextClear(prepared.snapshot.messages)
    : frozenContextManagementVersion === "v2"
      ? getMessagesForV2ActiveWindow(prepared.snapshot.messages)
      : getMessagesAfterLatestCompaction(prepared.snapshot.messages);
  const mappedConversationItems = await mapMessagesForResponsesInput(
    activeContextMessages,
    input.taskInputDir,
    prepared.snapshot.image_detail ?? "high",
    {
      quickMode: prepared.quickMode,
      sendMetadataToModel: prepared.snapshot.send_metadata_to_model,
      ...(prepared.settings.sandboxPdfPreparation ? { pdfRuntime: { sandbox: prepared.sandbox, scratchDir: prepared.taskScratchDir } } : {})
    }
  );
  const resolvedContextManagement = await resolveContextManagementState(prepared.control.context, {
    taskId: job.taskId,
    requestedVersion: frozenContextManagementVersion,
    runtimeModel: prepared.runtimeModel,
    branchLeafMessageId: prepared.snapshot.branch_leaf_message_id,
    seedItems: isManualClear ? [] : mappedConversationItems,
    skipHistoryReplay: isManualClear
  });
  return { mappedConversationItems, resolvedContextManagement };
}

// The stable prefix of an ordinary run, plus the window notes and live state at the start of its
// conversation. Swarm agents get the swarm guide, which covers the lane role too, so lanes forked
// from this prefix inherit it unchanged; Check lanes are fresh reviewers and get the Check prompt.
async function buildRunPromptEnvelope(input: {
  systemPrompt: string;
  prepared: PreparedAgentRunContext;
  workflow: WorkflowCapabilityState;
  swarm: SwarmRunContext | null;
  organization: Awaited<ReturnType<typeof prepareConversationOrganization>>;
  contextManagement: ContextManagementState;
  conversationItems: ResponseInputItem[];
}): Promise<ReturnType<typeof createPromptEnvelope>> {
  const { prepared, organization } = input;
  const promptEnvelope = createPromptEnvelope(input.systemPrompt);
  if (organization) appendPromptEnvelopeDelta(promptEnvelope, { reason: "conversation-organization", content: conversationOrganizationPrompt(organization) });
  if (prepared.isProjectMaster) appendPromptEnvelopeDelta(promptEnvelope, { reason: "project-master", content: buildProjectMasterPrompt() });
  const workflowPrompt = input.workflow.workflowPromptContext;
  const guide = input.swarm
    ? input.swarm.lane?.kind === "check" ? loadCheckPrompt() : loadSwarmGuide()
    : workflowPrompt?.guide;
  if (guide) {
    appendPromptEnvelopeDelta(promptEnvelope, { reason: "workflow-guide", role: "developer", content: guide });
  }
  if (input.contextManagement.version === "v2") {
    input.conversationItems.unshift(
      ...(await buildV2WindowDeveloperItems(prepared.control.context, {
        state: input.contextManagement,
        agentName: prepared.runtimeAgentId ?? "main"
      })),
      { role: "developer", content: CONTEXT_WINDOW_GUIDANCE }
    );
  }
  if (workflowPrompt?.liveState) {
    input.conversationItems.push({ role: "developer", content: workflowPrompt.liveState });
  }
  return promptEnvelope;
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
  if (!(await prepared.control.setTaskStatus("running"))) {
    throw new Error("TASK_CANCELLED");
  }
  await debugLogger.log("Task status set to running.", {
    stage: "init.status",
    phase: "success",
    status: "running"
  });

  const scheduleInfo = prepared.scheduleInfo;
  await debugLogger.log(scheduleInfo ? "Loaded task schedule state." : "No task schedule state configured.", {
    stage: "init.schedule",
    phase: "success",
    hasSchedule: scheduleInfo !== null,
    scheduleMode: scheduleInfo?.mode ?? null,
    scheduleState: scheduleInfo?.scheduleState ?? null
  });
  const runTiming = createRunTiming(job, prepared, scheduleInfo);
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
    isTimedInfiniteRun: runTiming.isTimedInfiniteRun
  });
  const { maxSteps } = prepared.settings;
  const maxRunSteps = Math.min(maxSteps, prepared.snapshot.task.max_steps_override ?? maxSteps);
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
      allowWorkflowSubmitReview: resolvedWorkflow.allowWorkflowSubmitReview
    })
  });
  const taskInputDir = resolveAgentTaskInputDir({
    taskDir: prepared.taskDir,
    workflowTaskDir: workflow.workflowContext?.workflowTaskDir
  });
  prepared.shellEnvOverrides.TASK_INPUT_DIR = taskInputDir;
  const swarm = await prepared.features.loadSwarm(prepared.snapshot.task, prepared.snapshot.platform_model_routers ?? []);
  const laneRun = swarm?.lane && swarm.lane.kind !== "check"
    ? await prepared.features.prepareLaneRun({
      contextStore: prepared.control.context,
      taskId: job.taskId,
      lane: swarm.lane,
      messages: prepared.snapshot.messages,
      branchLeafMessageId: prepared.snapshot.branch_leaf_message_id,
      runtimeModel: prepared.runtimeModel
    })
    : null;
  const isManualClear = job.mode === "compact_only" && job.contextAction === "clear";
  const { mappedConversationItems, resolvedContextManagement } = laneRun
    ? { mappedConversationItems: [], resolvedContextManagement: { state: laneRun.contextManagement, conversationItems: laneRun.conversationItems } }
    : await resolveRunConversation({ job, prepared, taskInputDir, isManualClear });
  const conversationItems = resolvedContextManagement.conversationItems;
  await prepared.cancellationMonitor.assertNotCancelled();
  if (job.mode !== "compact_only") {
    prepared.currentLeafMessageId = await reportInterruptedToolCalls({
      prepared,
      contextManagement: resolvedContextManagement.state,
      conversationItems
    });
  }

  const projectContextInitData = await debugLogger.stage({
    stage: "init.project_context",
    startMessage: "Loading project context prompt data.",
    successMessage: (result) => result.projectContext
      ? "Loaded project context prompt data."
      : "No project context prompt data found.",
    run: () => loadProjectContextInitData(
      prepared.envRoot,
      prepared.runtimeEnvironmentPayload,
      () => prepared.control.isDebugEnabled()
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
  const systemPrompt = toSandboxText(laneRun
    ? laneRun.promptEnvelope.baseFrames[0]?.content ?? fullSystemPrompt
    : prepared.quickMode ? buildQuickModeSystemPrompt(prepared.isProjectMaster === true) : fullSystemPrompt);
  let activeSystemPrompt = systemPrompt;
  await debugLogger.log("Built system prompt.", {
    stage: "init.system_prompt",
    phase: "success",
    promptLength: systemPrompt.length
  });
  const organization = laneRun ? undefined : await prepareConversationOrganization(prepared, job);
  const promptEnvelope = laneRun
    ? laneRun.promptEnvelope
    : await buildRunPromptEnvelope({ systemPrompt, prepared, workflow, swarm, organization, contextManagement: resolvedContextManagement.state, conversationItems });
  if (!prepared.quickMode) {
    // A lane's prompt notes are already in its inherited prefix; only the tools come back.
    const capabilityEnvelope = laneRun ? createPromptEnvelope("") : promptEnvelope;
    await debugLogger.stage({
      stage: "init.auto_enable",
      startMessage: "Auto-enabling selected skills and sources.",
      successMessage: "Auto-enabled selected skills and sources.",
      run: () => enableRunCapabilities({ prepared, promptEnvelope: capabilityEnvelope, enableSkillById, onDemandCapabilities, conversationItems }),
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
    hasActualContextUsage: false,
    lastActualContextUsage: null,
    finalResponseFromTool: null,
    waitRequest: null,
    stopRequest: null,
    workflowPauseRequest: null,
    workflowAssistantPauseResponse: null,
    notificationRequested: true,
    quickModeActive: prepared.quickMode,
    stepCount: 0
  };

  const assertRunNotAborted = createRunAbortAsserter(prepared, runTiming);
  const injectTimedRunFinalizationPrompt = (): void => {
    if (runTiming.timedRunFinalizationPromptInjected) {
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
    runTiming.timedRunFinalizationPromptInjected = true;
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
    maxRunSteps: swarm?.lane ? resolveLaneMaxSteps(swarm.settings.advanced.laneMaxSteps, maxRunSteps) : maxRunSteps,
    recurringStateFilePath,
    workflow,
    swarm,
    laneSeed: laneRun?.seed ?? null,
    systemPrompt: activeSystemPrompt,
    promptEnvelope,
    runTiming,
    state,
    assertRunNotAborted,
    injectTimedRunFinalizationPrompt,
    initializeQuickModeSandbox
  };
  return executionContext;
}
