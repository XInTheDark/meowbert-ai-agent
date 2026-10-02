import { loadSubagentRuntime, loadSubagentPlatformProvider } from "../subagents/runtime.js";
import type { FunctionTool, ResponseInputItem } from "openai/resources/responses/responses";
import path from "node:path";
import {
  buildGitHubRuntimeEnv,
  getProjectMasterEnabled,
  getWorkspaceDefaultAgentId,
  type TaskExecutionJob
} from "@meowbert/shared";
import {
  getSandboxNetworkEnabled,
  isSourceManifest,
  getVisiblePlatformAgentPresets,
  findPlatformAgentPresetById,
  normalizeAgentSwarmAgentAllocations,
  resolveCompatibilityModesForModel,
  resolveFastModel,
  resolveAgentSwarmAgentIdForWorkerSlot,
  resolvePlatformAgentPresetMode,
  resolveEffectiveEnvironmentJsonPayload,
  resolveModelTypeForModel,
  resolveContextManagementVersionForModel,
  type PlatformAgentPreset,
  type PlatformModelCompatibilityMode,
  type PlatformModelType
} from "@meowbert/shared";
import { assertSafePublicUrl } from "@meowbert/shared/server-security";
import { config } from "../../lib/config.js";
import { query } from "../../lib/db.js";
import { resolveRuntimeAiProvider } from "./runtime-provider.js";
import { mintGitHubRuntimeEnvFromConnection } from "../github/workspace-github-app.js";
import { resolveTaskEnvironmentRoot } from "../runtime/environment-storage.js";
import { resolveTaskWorkspaceRoot } from "../workspaces/workspace-storage.js";
import {
  startMcpServer,
  listMcpTools,
  mcpToolsToFunctionTools,
  skillToolPrefix,
  stopMcpServer,
  type McpConnection
} from "./mcp-client.js";
import { workerSandboxManager } from "../runtime/sandbox.js";
import { getSkillEntry, getSkillDoc } from "./skill-registry.js";
import {
  getTaskSnapshot,
  listTaskLiveSyncFilesForWorker,
  isUserSuperAdmin,
  resolveUserSandboxContainerResources,
  setTaskStatusForRun
} from "../agent-db/index.js";
import type { TaskSnapshot } from "./types.js";
import {
  deepMergeJsonObjects,
  isNetworkRequestLoggingEnabled,
  mergeTaskToolOptions,
  normalizeEnvironmentJsonPayload,
  extractModelRequestPayload,
  pickRunToolOptions
} from "./utils.js";
import {
  buildWorkspaceMemoryEnvVars,
  ensureProjectMemoryDir,
  ensureWorkspaceMemoryDir,
  ensureWorkspaceMemoryWatcher,
  readProjectMemoryMainFile,
  readWorkspaceMemoryMainFile
} from "../memory/index.js";
import { resolveTaskDir } from "../tasks/task-paths.js";
import { buildTaskSandboxMounts } from "./task-write-scope.js";
import { getMaxContextWindowTokens } from "../context-compaction/index.js";
import type { OpenAiProviderConfig } from "./openai-client.js";
import { resolveChatGptProvider } from "./chatgpt-auth.js";
import type { ToolDispatchState } from "../agent-tool-dispatch/index.js";
import type { TaskMessageToolOptions } from "./types.js";
import { isSkillEnabledByConfig } from "@meowbert/shared";
import { startTaskCancellationMonitor, type TaskCancellationMonitor } from "./cancellation.js";
import { ensureTaskWorkspace } from "../runtime/shell.js";
import { resolveModelRouterSelection } from "../model-routing/router-resolution.js";
import {
  resolveEffectiveRunAgentPreset,
  resolveMemorySynthesisAgentPreset,
  resolveReviewerAgentPreset
} from "./agent-preset-resolution.js";
import { resolveAgentTaskInputDir } from "./task-input-dir.js";
import { markTaskRunDispatchRunning } from "../tasks/task-run-dispatch.js";
import { buildSourceRuntimeEnv } from "./source-runtime.js";
import { buildSkillRuntimeEnv } from "./skill-runtime.js";
import type { NetworkRequestLogEvent } from "./network-request-log.js";
import { createNetworkRequestLogger } from "./network-request-event-storage.js";
import type { TaskLiveSyncFileSummary } from "./live-sync-types.js";
import { createTaskDebugLogger, isTaskDebugModeEnabled, type TaskDebugLogger } from "../runtime/debug-task-events.js";
import {
  GOOGLE_WORKSPACE_SKILL_ID,
  serializeGoogleWorkspaceReferences,
  type GoogleWorkspaceRuntimeReference
} from "./google-workspace-references.js";
import { hasTaskGoogleWorkspaceFolders, listProjectGoogleWorkspaceReferences } from "../agent-db/google-workspace-references.js";
import { ensureTaskSourceMounts, releaseTaskSourceMounts } from "./live-sync-client.js";
import { prepareTaskSourceMounts, verifyTaskSourceMounts } from "./live-sync-mounts.js";
import { createRecoverableSandboxController } from "./recoverable-sandbox.js";

interface GitHubTokenRefreshResult {
  ok: boolean;
  login?: string;
  expiresAt?: string | null;
  contentsPermission?: string | null;
  repositorySelection?: string | null;
  canReadContents?: boolean;
  canWriteContents?: boolean;
  error?: string;
}

type PersistentSandbox = Awaited<ReturnType<typeof workerSandboxManager.createPersistentSandbox>>;
type WorkspaceMemoryMainFile = Awaited<ReturnType<typeof readWorkspaceMemoryMainFile>>;
type ProjectMemoryMainFile = Awaited<ReturnType<typeof readProjectMemoryMainFile>>;

type EnableSkillById = (skillId: string) => Promise<{ doc: string | null; toolNames: string[] }>;
type EnableSourceById = (sourceId: string) => Promise<{ doc: string | null; toolNames: string[] }>;

export interface PreparedAgentRunContext {
  snapshot: TaskSnapshot;
  runActorUserId: string | null;
  resolvedRunActorIsSuperAdmin: boolean;
  envRoot: string;
  workspaceRoot: string;
  taskDir: string;
  liveSyncFiles: TaskLiveSyncFileSummary[];
  runStartedAt: Date;
  baseEnvironmentJsonPayload: Record<string, unknown>;
  networkRequestLoggingEnabled: boolean;
  quickMode: boolean;
  shellEnvOverrides: Record<string, string>;
  hasGitHubAppConnection: boolean;
  githubInstallationAccess: {
    contentsPermission: string | null;
    repositorySelection: string | null;
    canReadContents: boolean;
    canWriteContents: boolean;
  } | null;
  refreshGitHubToken?: () => Promise<GitHubTokenRefreshResult>;
  runtimeProvider: OpenAiProviderConfig;
  runtimeProviderKind?: "platform" | "byo" | "chatgpt";
  runtimeAgentId: string | null;
  isQualityReviewSpecialist: boolean;
  runtimeModel: string;
  runtimeCompatibilityModes: PlatformModelCompatibilityMode[];
  runtimeModelType: PlatformModelType;
  requestedContextManagementVersion: "v1" | "v2";
  runtimeEnvironmentPayload: Record<string, unknown>;
  memoryEnabled: boolean;
  thoughtPersistenceEnabled: boolean;
  memoryMainFile: WorkspaceMemoryMainFile | null;
  projectMemoryMainFile: ProjectMemoryMainFile | null;
  runtimeModelPayload: Record<string, unknown>;
  runtimeQuickModel: string;
  runtimeQuickModelCompatibilityModes: PlatformModelCompatibilityMode[];
  maxContextTokens: number;
  subscriptionUserId: string | null;
  // Super admins are billed for statistics but never blocked by subscription quota.
  subscriptionUserIsSuperAdmin: boolean;
  runPersistedItems: ResponseInputItem[];
  currentLeafMessageId: string | null;
  dispatchState: ToolDispatchState | null;
  runToolOptions: TaskMessageToolOptions;
  // Skills offered to the agent without loading their tools up front; it enables them on demand.
  onDemandSkills: string[];
  runShellMaxTimeoutSeconds: number;
  isSubtask: boolean;
  isProjectMaster?: boolean;
  skillsRootDir: string | null;
  activeMcpConnections: Map<string, McpConnection>;
  activeSkillTools: FunctionTool[];
  sandbox: PersistentSandbox;
  initializeSandbox: () => Promise<{ alreadyInitialized: boolean }>;
  cancellationMonitor: TaskCancellationMonitor;
  enableSkillById: EnableSkillById;
  enableSourceById: EnableSourceById;
  emitNetworkRequestLog: (event: NetworkRequestLogEvent) => Promise<void>;
  cleanup: (dispatchState: ToolDispatchState | null) => Promise<void>;
}

function resolveRunActorUserId(snapshot: TaskSnapshot, job: TaskExecutionJob): string | null {
  return typeof job.selectionUserId === "string" && job.selectionUserId.length > 0
    ? job.selectionUserId
    : snapshot.task.initiator_user_id;
}

async function resolveRunActorIsSuperAdmin(snapshot: TaskSnapshot, runActorUserId: string | null): Promise<boolean> {
  if (!runActorUserId) {
    return false;
  }
  if (runActorUserId === snapshot.initiator_user?.id) {
    return snapshot.initiator_user?.is_super_admin === true;
  }
  return isUserSuperAdmin(runActorUserId);
}

async function resolveAgentSwarmAgentId(snapshot: TaskSnapshot): Promise<string | null> {
  if (snapshot.task.workflow_type !== "agent_swarm") {
    return null;
  }

  const workflowTaskId = snapshot.task.workflow_parent_task_id ?? snapshot.task.id;
  const result = await query<{
    state_json: Record<string, unknown> | null;
    slot_index: number;
    config_json: Record<string, unknown> | null;
  }>(
    `SELECT a.slot_index,
            a.state_json,
            w.config_json
       FROM task_workflow_agents a
       JOIN task_workflows w ON w.task_id = a.workflow_task_id
      WHERE a.workflow_task_id = $1
        AND a.task_id = $2
      LIMIT 1`,
    [workflowTaskId, snapshot.task.id]
  );
  const row = result.rows[0] ?? null;
  if (!row) {
    return null;
  }

  const stateAgentId = row.state_json?.agentPresetId;
  if (typeof stateAgentId === "string" && stateAgentId.trim().length > 0) {
    return stateAgentId.trim().toLowerCase();
  }

  if (snapshot.task.workflow_internal_role !== "worker") {
    const leaderAgentId = row.config_json?.leaderAgentId;
    return typeof leaderAgentId === "string" && leaderAgentId.trim()
      ? leaderAgentId.trim().toLowerCase()
      : null;
  }

  return resolveAgentSwarmAgentIdForWorkerSlot(
    normalizeAgentSwarmAgentAllocations(row.config_json?.modelAllocations),
    row.slot_index
  );
}

async function resolveEffectiveAgentPreset(input: {
  snapshot: TaskSnapshot;
  visibleAgentPresets: PlatformAgentPreset[];
}): Promise<PlatformAgentPreset | null> {
  const selectedAgentPreset = resolveEffectiveRunAgentPreset(
    input.snapshot.messages,
    input.visibleAgentPresets,
    getWorkspaceDefaultAgentId(input.snapshot.workspace_model_defaults)
  );
  const swarmAgentId = await resolveAgentSwarmAgentId(input.snapshot);
  if (!swarmAgentId) {
    return selectedAgentPreset;
  }

  return findPlatformAgentPresetById(input.visibleAgentPresets, swarmAgentId) ?? selectedAgentPreset;
}

async function registerTaskWorkspace(taskId: string, taskDir: string, envRoot: string): Promise<void> {
  await ensureTaskWorkspace(taskDir, envRoot);
  await query(
    `INSERT INTO task_workspaces (task_id, fs_path, mount_mode)
     SELECT $1, $2, 'rw_task_nested_env'
      WHERE NOT EXISTS (
        SELECT 1
          FROM task_workspaces
         WHERE task_id = $1
           AND fs_path = $2
           AND mount_mode = 'rw_task_nested_env'
           AND disposed_at IS NULL
      )`,
    [taskId, taskDir]
  );
}

async function startRunRecord(runId: string): Promise<Date> {
  const workerId = `${process.pid}`;
  const runStartRes = await query<{ started_at: string }>(
    `UPDATE task_runs
        SET worker_id = $2,
            started_at = now()
      WHERE id = $1
    RETURNING started_at`,
    [runId, workerId]
  );
  await markTaskRunDispatchRunning(runId);
  return new Date(runStartRes.rows[0]?.started_at ?? new Date().toISOString());
}

async function createRefreshGitHubToken(
  snapshot: TaskSnapshot,
  shellEnvOverrides: Record<string, string>,
  abortSignal?: AbortSignal
) {
  if (!snapshot.github_connection) {
    return undefined;
  }

  return async (): Promise<GitHubTokenRefreshResult> => {
    const githubConnection = snapshot.github_connection;
    if (!githubConnection) {
      return { ok: false, error: "No GitHub connection is configured for this workspace." };
    }

    try {
      if (githubConnection.type === "oauth") {
        const env = buildGitHubRuntimeEnv({
          accessToken: githubConnection.access_token,
          login: githubConnection.github_login,
          name: githubConnection.github_name,
          email: githubConnection.github_email,
          defaultOrg: githubConnection.default_org
        });
        if (Object.keys(env).length === 0) {
          return { ok: false, error: "GitHub OAuth connection is missing a usable access token." };
        }

        Object.assign(shellEnvOverrides, env);
        return { ok: true, login: githubConnection.github_login, expiresAt: null };
      }

      const minted = await mintGitHubRuntimeEnvFromConnection({
        connection: githubConnection,
        abortSignal
      });
      if (!minted) {
        return { ok: false, error: "GitHub App installation is missing or invalid for this workspace." };
      }

      Object.assign(shellEnvOverrides, minted.env);
      return {
        ok: true,
        login: minted.login,
        expiresAt: minted.expiresAt,
        contentsPermission: minted.contentsPermission,
        repositorySelection: minted.repositorySelection,
        canReadContents: minted.canReadContents,
        canWriteContents: minted.canWriteContents
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  };
}

async function resolveRoutedRuntime(input: {
  snapshot: TaskSnapshot;
  runId: string;
  debugLogger: TaskDebugLogger;
  taskInputDir: string;
  memoryFiles: {
    memoryMainFile: WorkspaceMemoryMainFile | null;
    projectMemoryMainFile: ProjectMemoryMainFile | null;
  };
  runtimeProvider: OpenAiProviderConfig;
  runtimeProviderKind?: "platform" | "byo" | "chatgpt";
  requestedRuntimeModel: string;
  runtimeModel: string;
  runtimeEnvironmentPayload: Record<string, unknown>;
  quickMode: boolean;
  usingByoProvider: boolean;
  abortSignal?: AbortSignal;
}) {
  let runtimeModel = input.runtimeModel;
  let runtimeEnvironmentPayload = input.runtimeEnvironmentPayload;
  let quickMode = input.quickMode;
  if (!input.usingByoProvider) {
    const routedModel = await input.debugLogger.stage({
      stage: "startup.model_router",
      startMessage: "Evaluating model router selection.",
      successMessage: (resolution) => resolution
        ? "Resolved model router selection."
        : "No model router matched the requested model.",
      run: () => resolveModelRouterSelection({
        taskId: input.snapshot.task.id,
        billing: input.snapshot.task.initiator_user_id
          ? { userId: input.snapshot.task.initiator_user_id, taskId: input.snapshot.task.id, runId: input.runId }
          : null,
        requestedModel: input.requestedRuntimeModel,
        environmentPayload: runtimeEnvironmentPayload,
        platformModelRouters: input.snapshot.platform_model_routers,
        provider: input.runtimeProvider,
        branchMessageId: input.snapshot.branch_leaf_message_id,
        messages: input.snapshot.messages,
        taskInputDir: input.taskInputDir,
        memoryMainFile: input.memoryFiles.memoryMainFile,
        projectMemoryMainFile: input.memoryFiles.projectMemoryMainFile,
        imageDetail: input.snapshot.image_detail ?? "high",
        requestTimeoutMs: input.snapshot.model_request_timeout_ms,
        abortSignal: input.abortSignal
      }),
      startPayload: {
        requestedModel: input.requestedRuntimeModel
      },
      successPayload: (resolution) => resolution
        ? {
            requestedModel: resolution.requestedModel,
            resolvedModel: resolution.resolvedModel,
            routingModel: resolution.routingModel,
            reasoningEffort: resolution.reasoningEffort,
            cached: resolution.cached,
            usedFallback: resolution.usedFallback
          }
        : {
            requestedModel: input.requestedRuntimeModel,
            matched: false
          }
    });
    if (routedModel) {
      runtimeModel = routedModel.resolvedModel;
      runtimeEnvironmentPayload = routedModel.resolvedEnvironmentPayload;
      quickMode = quickMode || routedModel.quickMode;
    }
  }
  if (input.snapshot.task.workflow_type !== null) {
    quickMode = false;
  }
  if (input.snapshot.interactive_canvas || pickRunToolOptions(input.snapshot.messages).interactiveCanvas === true) {
    quickMode = false;
  }
  return { runtimeModel, runtimeEnvironmentPayload, quickMode };
}

async function resolveRuntimeConfig(
  job: TaskExecutionJob,
  snapshot: TaskSnapshot,
  resolvedRunActorIsSuperAdmin: boolean,
  debugLogger: TaskDebugLogger,
  taskInputDir: string,
  memoryFiles: {
    memoryMainFile: WorkspaceMemoryMainFile | null;
    projectMemoryMainFile: ProjectMemoryMainFile | null;
  },
  quickModeRequested: boolean,
  abortSignal?: AbortSignal
) {
  const baseEnvironmentJsonPayload = normalizeEnvironmentJsonPayload(
    resolveEffectiveEnvironmentJsonPayload({
      workspaceModelDefaults: snapshot.workspace_model_defaults,
      environmentPayload: snapshot.environment.json_payload
    })
  );
  const visibleAgentPresets = getVisiblePlatformAgentPresets(
    snapshot.platform_agent_presets,
    resolvedRunActorIsSuperAdmin
  );
  const inheritedRuntime = snapshot.task.parent_task_id ? await loadSubagentRuntime(job.taskId) : null;
  const selectedAgentPreset = inheritedRuntime ? null : await resolveEffectiveAgentPreset({ snapshot, visibleAgentPresets });
  const isMemorySynthesis = job.mode === "memory_synthesis";
  const isQualityControlReviewer = job.mode === "quality_control_reviewer";
  const isQualityReviewSpecialist = isQualityControlReviewer
    || resolvePlatformAgentPresetMode(selectedAgentPreset) === "quality_control_reviewer";
  const runtimeAgentPreset = isMemorySynthesis
    ? resolveMemorySynthesisAgentPreset(
      snapshot.platform_specialized_models.memorySynthesisAgent,
      visibleAgentPresets
    )
    : isQualityControlReviewer
      ? resolveReviewerAgentPreset(
        snapshot.platform_specialized_models.reviewerAgent,
        visibleAgentPresets
      )
    : selectedAgentPreset;
  if (resolvePlatformAgentPresetMode(runtimeAgentPreset) === "agent_swarm") {
    throw new Error("Agent Swarm preset was selected without a swarm member assignment.");
  }

  const initiator = snapshot.initiator_user;
  const byoEnabled = initiator?.byo_enabled === true;
  const isChatGptByo = byoEnabled && initiator?.byo_provider === "chatgpt_oauth";
  const byoBaseUrl = initiator?.byo_base_url?.trim() ?? "";
  const byoApiKey = initiator?.byo_api_key?.trim() ?? "";
  const byoModel = initiator?.byo_model?.trim() ?? "";
  const usingCustomByo = inheritedRuntime ? inheritedRuntime.provider.kind === "byo" : !isMemorySynthesis && !isQualityReviewSpecialist
    && byoEnabled && !isChatGptByo && byoBaseUrl.length > 0 && byoApiKey.length > 0 && byoModel.length > 0;
  const usingChatGptByo = inheritedRuntime ? inheritedRuntime.provider.kind === "chatgpt" : !isMemorySynthesis && !isQualityReviewSpecialist && isChatGptByo;
  const usingByoProvider = usingCustomByo || usingChatGptByo;

  if (!inheritedRuntime && !isMemorySynthesis && !isQualityReviewSpecialist && byoEnabled && !usingByoProvider) {
    throw new Error("BYO provider is enabled but configuration is incomplete.");
  }
  if (usingCustomByo) {
    await assertSafePublicUrl(byoBaseUrl, "BYO base URL");
  }

  let chatGptProviderConfig: (OpenAiProviderConfig & { model: string | null }) | null = null;
  if (usingChatGptByo && initiator) {
    chatGptProviderConfig = await resolveChatGptProvider(initiator.id);
  }
  const useTaskSelectedModel = !usingByoProvider
    || (usingChatGptByo && !chatGptProviderConfig?.model?.trim());

  const runtimeProvider = inheritedRuntime?.provider.kind === "platform"
    ? await loadSubagentPlatformProvider(inheritedRuntime.provider.baseUrl)
    : await resolveRuntimeAiProvider(usingChatGptByo && chatGptProviderConfig
    ? {
        apiKey: chatGptProviderConfig.apiKey,
        baseUrl: chatGptProviderConfig.baseUrl,
        defaultHeaders: chatGptProviderConfig.defaultHeaders,
        chatGptCodex: chatGptProviderConfig.chatGptCodex
      }
    : usingCustomByo
      ? { apiKey: byoApiKey, baseUrl: byoBaseUrl }
      : undefined);

  let requestedRuntimeModel = usingChatGptByo && chatGptProviderConfig?.model
    ? chatGptProviderConfig.model
    : usingCustomByo
      ? byoModel
      : snapshot.model;
  let runtimeModel = inheritedRuntime?.model ?? requestedRuntimeModel;
  let runtimeEnvironmentPayload = inheritedRuntime
    ? { ...baseEnvironmentJsonPayload, responses: inheritedRuntime.payload }
    : baseEnvironmentJsonPayload;
  let quickMode = quickModeRequested;

  if (!inheritedRuntime && useTaskSelectedModel && runtimeAgentPreset) {
    const agentPayload = { ...runtimeAgentPreset.payload };
    const modelCandidate = agentPayload.model;
    if (typeof modelCandidate === "string") {
      const trimmedModelCandidate = modelCandidate.trim();
      if (trimmedModelCandidate.length > 0) {
        requestedRuntimeModel = trimmedModelCandidate;
        runtimeModel = trimmedModelCandidate;
      }
    }

    delete agentPayload.model;
    runtimeEnvironmentPayload = deepMergeJsonObjects(baseEnvironmentJsonPayload, agentPayload);
  }

  if (!inheritedRuntime) ({ runtimeModel, runtimeEnvironmentPayload, quickMode } = await resolveRoutedRuntime({
    snapshot,
    runId: job.runId,
    debugLogger,
    taskInputDir,
    memoryFiles,
    runtimeProvider,
    requestedRuntimeModel,
    runtimeModel,
    runtimeEnvironmentPayload,
    quickMode,
    usingByoProvider,
    abortSignal
  }));
  const memoryEnabled = snapshot.environment.workspace_memory_enabled === true;
  const runtimeQuickModel = usingByoProvider
    ? runtimeModel
    : resolveFastModel({ specializedModels: snapshot.platform_specialized_models, fallbackModel: runtimeModel });
  return {
    baseEnvironmentJsonPayload,
    runtimeProvider,
    runtimeProviderKind: usingCustomByo ? "byo" as const : usingChatGptByo ? "chatgpt" as const : "platform" as const,
    runtimeAgentId: runtimeAgentPreset?.id ?? null,
    isQualityReviewSpecialist,
    runtimeModel,
    runtimeCompatibilityModes: resolveCompatibilityModesForModel(runtimeModel, snapshot.platform_model_metadata),
    runtimeModelType: resolveModelTypeForModel(runtimeModel, snapshot.platform_model_metadata),
    requestedContextManagementVersion: resolveContextManagementVersionForModel(runtimeModel, snapshot.platform_model_metadata),
    runtimeEnvironmentPayload,
    memoryEnabled,
    thoughtPersistenceEnabled: memoryEnabled && snapshot.thought_persistence_enabled === true,
    runtimeModelPayload: extractModelRequestPayload(runtimeEnvironmentPayload),
    runtimeQuickModel,
    runtimeQuickModelCompatibilityModes: resolveCompatibilityModesForModel(
      runtimeQuickModel,
      snapshot.platform_model_metadata
    ),
    maxContextTokens: getMaxContextWindowTokens(runtimeModel, snapshot.platform_model_metadata),
    networkRequestLoggingEnabled: isNetworkRequestLoggingEnabled(baseEnvironmentJsonPayload),
    quickMode,
    hasPlatformInitiator:
      !usingByoProvider
      && typeof snapshot.task.initiator_user_id === "string"
      && snapshot.task.initiator_user_id.length > 0,
    hasGitHubAppConnection: snapshot.github_connection !== null
  };
}

async function prepareWorkspaceMemory(
  workspaceRoot: string,
  projectId: string,
  projectName: string | null | undefined,
  memoryEnabled: boolean,
  shellEnvOverrides: Record<string, string>
): Promise<{
  memoryMainFile: WorkspaceMemoryMainFile | null;
  projectMemoryMainFile: ProjectMemoryMainFile | null;
}> {
  let memoryMainFile: WorkspaceMemoryMainFile | null = null;
  let projectMemoryMainFile: ProjectMemoryMainFile | null = null;
  if (memoryEnabled) {
    await ensureWorkspaceMemoryDir(workspaceRoot);
    await ensureProjectMemoryDir({ workspaceRoot, projectId, projectName });
    void ensureWorkspaceMemoryWatcher(workspaceRoot);
    memoryMainFile = await readWorkspaceMemoryMainFile(workspaceRoot);
    projectMemoryMainFile = await readProjectMemoryMainFile({ workspaceRoot, projectId, projectName });
  }
  Object.assign(shellEnvOverrides, buildWorkspaceMemoryEnvVars(workspaceRoot, memoryEnabled, projectId));
  return { memoryMainFile, projectMemoryMainFile };
}

function resolveRunToolOptions(snapshot: TaskSnapshot, job: TaskExecutionJob, memoryEnabled: boolean): TaskMessageToolOptions {
  const baseToolOptions = pickRunToolOptions(snapshot.messages);
  const mergedRunToolOptions = mergeTaskToolOptions(baseToolOptions, job.toolOptionsOverride);
  const runToolOptions = memoryEnabled
    ? mergedRunToolOptions
    : {
        ...mergedRunToolOptions,
        memorySearch: false
      };

  if (job.mode === "scheduled_auto" || job.mode === "infinite_auto") {
    runToolOptions.scheduleTask = false;
  }

  return runToolOptions;
}

async function createSandbox(input: {
  debugLogger: TaskDebugLogger;
  actorUserId: string | null;
  baseEnvironmentJsonPayload: Record<string, unknown>;
  forceNetworkEnabled: boolean;
  envRoot: string;
  isThreadTask: boolean;
  skillsRootDir: string | null;
  taskDir: string;
  taskId: string;
  runId: string;
  workspaceId: string;
  environmentId: string;
  workspaceRoot: string;
  workflowType: TaskSnapshot["task"]["workflow_type"];
  workflowTaskId: string | null;
  workspaceRunAsRoot: boolean;
  envOverrides: Record<string, string>;
}): Promise<PersistentSandbox> {
  const networkEnabled = input.forceNetworkEnabled || getSandboxNetworkEnabled(input.baseEnvironmentJsonPayload);
  const resources = await input.debugLogger.stage({
    stage: "startup.sandbox.resources",
    startMessage: "Resolving sandbox resource limits.",
    successMessage: "Resolved sandbox resource limits.",
    run: () => resolveUserSandboxContainerResources(input.actorUserId),
    successPayload: (resolvedResources) => ({
      pids: resolvedResources.pids ?? null,
      memoryMb: resolvedResources.memoryMb ?? null,
      cpus: resolvedResources.cpus ?? null
    })
  });
  const mounts = await input.debugLogger.stage({
    stage: "startup.sandbox.mount_plan",
    startMessage: "Building sandbox mount plan.",
    successMessage: "Built sandbox mount plan.",
    run: () => buildTaskSandboxMounts({
      envRoot: input.envRoot,
      workspaceRoot: input.workspaceRoot,
      isThreadTask: input.isThreadTask,
      workflowType: input.workflowType,
      workflowTaskId: input.workflowTaskId,
      skillsRootDir: input.skillsRootDir
    }),
    successPayload: (resolvedMounts) => ({
      mountCount: resolvedMounts.length,
      writableMountCount: resolvedMounts.filter((mount) => mount.readOnly !== true).length,
      mounts: resolvedMounts.map((mount) => ({
        path: mount.path,
        readOnly: mount.readOnly === true,
        optional: mount.optional === true
      }))
    })
  });
  const sourceMountPaths = await ensureTaskSourceMounts({
    userId: input.actorUserId,
    taskId: input.taskId,
    workspaceId: input.workspaceId
  });
  const sourceMounts = await prepareTaskSourceMounts(sourceMountPaths, input.isThreadTask);
  const sandbox = await workerSandboxManager.createPersistentSandbox({
    workingDir: input.taskDir,
    networkEnabled,
    mounts: [...mounts, ...sourceMounts],
    env: input.envOverrides,
    runAsRoot: input.workspaceRunAsRoot,
    resources,
    labels: {
      purpose: "task-run",
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      taskId: input.taskId,
      runId: input.runId
    },
    onLifecycleEvent: async (event) => {
      await input.debugLogger.log(event.message, {
        stage: `startup.${event.stage}`,
        phase: event.phase,
        ...(event.payload ?? {})
      });
    }
  });
  try {
    await verifyTaskSourceMounts(sandbox, sourceMountPaths, input.taskDir);
    return sandbox;
  } catch (error) {
    await sandbox.stop();
    throw error;
  }
}

interface SkillManagerInput {
  activeMcpConnections: Map<string, McpConnection>;
  activeSkillTools: FunctionTool[];
  actorUserId: string | null;
  mcpTimeoutMs: number;
  resolvedRunActorIsSuperAdmin: boolean;
  sandbox: PersistentSandbox;
  skillsRootDir: string | null;
  taskId: string;
  taskDir: string;
  canvas?: {
    id: string;
    absolutePath: string;
    entryPath: string;
  } | null;
  workspaceId: string;
  workspaceRoot: string;
  googleWorkspaceReferences: GoogleWorkspaceRuntimeReference[];
}

type EnabledManifestEntry = {
  doc: string | null;
  toolNames: string[];
  entry: NonNullable<ReturnType<typeof getSkillEntry>>;
};

function resolveSkillManifestEntry(input: SkillManagerInput, manifestId: string) {
  if (!input.skillsRootDir) {
    throw new Error("Skills are not configured (skills.rootDir is not set).");
  }
  return getSkillEntry(input.skillsRootDir, manifestId);
}

function createManifestEnabler(
  input: SkillManagerInput,
  defaultSkillRuntimeEnv: Record<string, string>
) {
  return async (manifestId: string, runtimeEnv?: Record<string, string>): Promise<EnabledManifestEntry> => {
    const entry = resolveSkillManifestEntry(input, manifestId);
    const doc = entry ? getSkillDoc(entry.skillDir) : null;
    if (input.activeMcpConnections.has(manifestId)) {
      const toolNames = input.activeSkillTools
        .filter((tool) => tool.name.startsWith(skillToolPrefix(manifestId)))
        .map((tool) => tool.name);
      if (!entry) {
        throw new Error(`Skill not found: ${manifestId}`);
      }
      return { doc, toolNames, entry };
    }
    if (!entry || entry.manifest.requiresSuperAdmin === true && !input.resolvedRunActorIsSuperAdmin) {
      throw new Error(`Skill not found: ${manifestId}`);
    }

    const connection = await startMcpServer(
      entry.manifest,
      entry.skillDir,
      input.sandbox,
      input.mcpTimeoutMs,
      { ...defaultSkillRuntimeEnv, ...(runtimeEnv ?? {}) }
    );
    input.activeMcpConnections.set(manifestId, connection);
    const functionTools = mcpToolsToFunctionTools(manifestId, await listMcpTools(connection));
    input.activeSkillTools.push(...functionTools);
    return { doc, toolNames: functionTools.map((tool) => tool.name), entry };
  };
}

function createSkillEnabler(
  input: SkillManagerInput,
  enableManifestEntry: (manifestId: string, runtimeEnv?: Record<string, string>) => Promise<EnabledManifestEntry>
): EnableSkillById {
  return async (skillId) => {
    if (!isSkillEnabledByConfig(config, skillId)) {
      throw new Error(`Skill disabled in server config: ${skillId}`);
    }

    const entry = resolveSkillManifestEntry(input, skillId);
    if (!entry || isSourceManifest(entry.manifest)) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    let runtimeEnv: Record<string, string> | undefined;
    if (entry.manifest.sourceAccess) {
      const sourceEntry = resolveSkillManifestEntry(input, entry.manifest.sourceAccess.sourceId);
      if (!sourceEntry || !isSourceManifest(sourceEntry.manifest) || !sourceEntry.manifest.source?.provider) {
        throw new Error(`Source not found: ${entry.manifest.sourceAccess.sourceId}`);
      }
      runtimeEnv = {
        ...buildSourceRuntimeEnv({
          userId: input.actorUserId ?? "system-source-run",
          taskId: input.taskId,
          taskDir: input.taskDir,
          workspaceId: input.workspaceId,
          workspaceRoot: input.workspaceRoot,
          sourceId: entry.manifest.sourceAccess.sourceId,
          provider: sourceEntry.manifest.source.provider,
          ticketScope: "source_reference_proxy"
        }),
        ...(skillId === GOOGLE_WORKSPACE_SKILL_ID
          ? { GOOGLE_WORKSPACE_REFERENCES_JSON: serializeGoogleWorkspaceReferences(input.googleWorkspaceReferences) }
          : {})
      };
    }
    const enabled = await enableManifestEntry(skillId, runtimeEnv);
    return { doc: enabled.doc, toolNames: enabled.toolNames };
  };
}

function createSourceEnabler(
  input: SkillManagerInput,
  enableManifestEntry: (manifestId: string, runtimeEnv?: Record<string, string>) => Promise<EnabledManifestEntry>
): EnableSourceById {
  return async (sourceId) => {
    const entry = resolveSkillManifestEntry(input, sourceId);
    if (!entry || !isSourceManifest(entry.manifest) || !entry.manifest.source?.provider) {
      throw new Error(`Source not found: ${sourceId}`);
    }
    const runtimeEnv = buildSourceRuntimeEnv({
      userId: input.actorUserId ?? "system-source-run",
      taskId: input.taskId,
      taskDir: input.taskDir,
      workspaceId: input.workspaceId,
      workspaceRoot: input.workspaceRoot,
      sourceId,
      provider: entry.manifest.source.provider
    });
    const enabled = await enableManifestEntry(sourceId, runtimeEnv);
    return { doc: enabled.doc, toolNames: enabled.toolNames };
  };
}

async function cleanupMcpConnections(activeMcpConnections: Map<string, McpConnection>): Promise<void> {
  for (const connection of activeMcpConnections.values()) {
    await stopMcpServer(connection);
  }
  activeMcpConnections.clear();
}

async function buildSkillManager(input: SkillManagerInput) {
  const defaultSkillRuntimeEnv = buildSkillRuntimeEnv({
    taskDir: input.taskDir,
    canvas: input.canvas,
    workspaceRoot: input.workspaceRoot
  });
  const enableManifestEntry = createManifestEnabler(input, defaultSkillRuntimeEnv);
  return {
    enableSkillById: createSkillEnabler(input, enableManifestEntry),
    enableSourceById: createSourceEnabler(input, enableManifestEntry),
    cleanupMcpConnections: () => cleanupMcpConnections(input.activeMcpConnections)
  };
}

async function loadPreparedRunIdentity(job: TaskExecutionJob, debugLogger: TaskDebugLogger) {
  const snapshot = await debugLogger.stage({
    stage: "startup.snapshot",
    startMessage: "Loading task snapshot.",
    successMessage: "Loaded task snapshot.",
    run: () => getTaskSnapshot(job.taskId, job.branchMessageId ?? null),
    successPayload: (resolvedSnapshot) => ({
      messageCount: resolvedSnapshot.messages.length,
      workflowType: resolvedSnapshot.task.workflow_type ?? null,
      hasGitHubAppConnection: resolvedSnapshot.github_connection !== null
    })
  });
  const runActorUserId = resolveRunActorUserId(snapshot, job);
  const resolvedRunActorIsSuperAdmin = await resolveRunActorIsSuperAdmin(snapshot, runActorUserId);
  await debugLogger.log("Resolved run actor permissions.", {
    stage: "startup.actor",
    phase: "success",
    actorUserId: runActorUserId,
    actorIsSuperAdmin: resolvedRunActorIsSuperAdmin
  });
  const envRoot = await debugLogger.stage({
    stage: "startup.environment_root",
    startMessage: "Resolving environment root.",
    successMessage: "Resolved environment root.",
    run: () => resolveTaskEnvironmentRoot({
      workspaceId: snapshot.task.workspace_id,
      environmentId: snapshot.environment.id,
      rootPath: snapshot.environment.root_path
    }),
    successPayload: (resolvedRoot) => ({
      environmentId: snapshot.environment.id,
      rootPath: resolvedRoot
    })
  });
  const workspaceRoot = await debugLogger.stage({
    stage: "startup.workspace_root",
    startMessage: "Resolving workspace root.",
    successMessage: "Resolved workspace root.",
    run: () => resolveTaskWorkspaceRoot({
      workspaceId: snapshot.task.workspace_id,
      rootPath: snapshot.environment.workspace_root_path
    }),
    successPayload: (resolvedRoot) => ({
      workspaceId: snapshot.task.workspace_id,
      rootPath: resolvedRoot
    })
  });
  const taskDir = resolveTaskDir(envRoot, snapshot.task.task_root_path);
  await debugLogger.stage({
    stage: "startup.task_workspace",
    startMessage: "Registering task workspace.",
    successMessage: "Registered task workspace.",
    run: () => registerTaskWorkspace(job.taskId, taskDir, envRoot),
    successPayload: { taskDir }
  });
  const liveSyncFiles = await debugLogger.stage({
    stage: "startup.live_sync",
    startMessage: "Loading live sync file links.",
    successMessage: "Loaded live sync file links.",
    run: () => listTaskLiveSyncFilesForWorker({
      taskId: snapshot.task.id,
      workspaceId: snapshot.task.workspace_id,
      environmentId: snapshot.task.environment_id,
      taskRootPath: snapshot.task.task_root_path
    }),
    successPayload: (files) => ({ fileCount: files.length })
  });
  const runStartedAt = await debugLogger.stage({
    stage: "startup.run_record",
    startMessage: "Marking run as started.",
    successMessage: "Marked run as started.",
    run: () => startRunRecord(job.runId),
    successPayload: (startedAt) => ({
      runId: job.runId,
      startedAt: startedAt.toISOString()
    })
  });
  return {
    snapshot,
    runActorUserId,
    resolvedRunActorIsSuperAdmin,
    envRoot,
    workspaceRoot,
    taskDir,
    liveSyncFiles,
    runStartedAt
  };
}

function buildInitialShellEnvironment(
  snapshot: TaskSnapshot,
  envRoot: string,
  workspaceRoot: string
): Record<string, string> {
  const shellEnvOverrides: Record<string, string> = {
    WORKSPACE_ROOT: workspaceRoot,
    MEOWBERT_WORKSPACE_ROOT: workspaceRoot
  };
  if (snapshot.interactive_canvas) {
    const canvasDir = path.resolve(envRoot, snapshot.interactive_canvas.root_path);
    Object.assign(shellEnvOverrides, {
      CANVAS_DIR: canvasDir,
      MEOWBERT_CANVAS_DIR: canvasDir,
      CANVAS_ID: snapshot.interactive_canvas.id,
      CANVAS_ENTRY_PATH: snapshot.interactive_canvas.entry_path
    });
  }
  return shellEnvOverrides;
}

async function startPreparedCancellationMonitor(
  job: TaskExecutionJob,
  snapshot: TaskSnapshot,
  debugLogger: TaskDebugLogger
): Promise<TaskCancellationMonitor> {
  const cancellationMonitor = startTaskCancellationMonitor(job.taskId, job.runId, {
    timeLimitDeadlineAt: snapshot.task.time_limit_deadline_at
  });
  await debugLogger.log("Started cancellation monitor.", {
    stage: "startup.cancellation_monitor",
    phase: "success",
    hasTimeLimitDeadline: snapshot.task.time_limit_deadline_at !== null
  });
  return cancellationMonitor;
}

async function resolvePreparedRunBase(job: TaskExecutionJob, debugLogger: TaskDebugLogger) {
  const identity = await loadPreparedRunIdentity(job, debugLogger);
  const {
    snapshot,
    runActorUserId,
    resolvedRunActorIsSuperAdmin,
    envRoot,
    workspaceRoot,
    taskDir,
    liveSyncFiles,
    runStartedAt
  } = identity;
  const shellEnvOverrides = buildInitialShellEnvironment(snapshot, envRoot, workspaceRoot);
  const cancellationMonitor = await startPreparedCancellationMonitor(job, snapshot, debugLogger);
  try {
    const refreshGitHubToken = await createRefreshGitHubToken(
      snapshot,
      shellEnvOverrides,
      cancellationMonitor.signal
    );
    let githubTokenRefreshResult: GitHubTokenRefreshResult | null = null;
    if (refreshGitHubToken) {
      githubTokenRefreshResult = await debugLogger.stage({
        stage: "startup.github_token",
        startMessage: "Refreshing GitHub token for startup.",
        successMessage: (result) => result.ok
          ? "Refreshed GitHub token for startup."
          : "GitHub token refresh failed during startup.",
        run: refreshGitHubToken,
        successPayload: (result) => ({
          ok: result.ok,
          login: result.login ?? null,
          expiresAt: result.expiresAt ?? null,
          contentsPermission: result.contentsPermission ?? null,
          repositorySelection: result.repositorySelection ?? null,
          canReadContents: result.canReadContents ?? null,
          canWriteContents: result.canWriteContents ?? null,
          error: result.error ?? null
        })
      });
    }
    const githubInstallationAccess = githubTokenRefreshResult?.ok
      ? {
          contentsPermission: githubTokenRefreshResult.contentsPermission ?? null,
          repositorySelection: githubTokenRefreshResult.repositorySelection ?? null,
          canReadContents: githubTokenRefreshResult.canReadContents === true,
          canWriteContents: githubTokenRefreshResult.canWriteContents === true
        }
      : null;

    const memoryEnabled = snapshot.environment.workspace_memory_enabled === true;
    const memoryFiles = await debugLogger.stage({
      stage: "startup.workspace_memory",
      startMessage: "Preparing workspace memory.",
      successMessage: "Prepared workspace memory.",
      run: () => prepareWorkspaceMemory(
        workspaceRoot,
        snapshot.environment.id,
        snapshot.environment.name,
        memoryEnabled,
        shellEnvOverrides
      ),
      successPayload: (memoryFilesResult) => ({
        memoryEnabled,
        memoryMainFilePath: memoryFilesResult.memoryMainFile?.path ?? null,
        memoryMainFileTruncated: memoryFilesResult.memoryMainFile?.truncated ?? false,
        projectMemoryMainFilePath: memoryFilesResult.projectMemoryMainFile?.path ?? null,
        projectMemoryMainFileTruncated: memoryFilesResult.projectMemoryMainFile?.truncated ?? false
      })
    });
    const taskInputDir = resolveAgentTaskInputDir({ taskDir });
    const runtimeConfig = await debugLogger.stage({
      stage: "startup.runtime_config",
      startMessage: "Resolving runtime configuration.",
      successMessage: "Resolved runtime configuration.",
      run: () => resolveRuntimeConfig(
        job,
        snapshot,
        resolvedRunActorIsSuperAdmin,
        debugLogger,
        taskInputDir,
        memoryFiles,
        job.quickMode === true,
        cancellationMonitor.signal
      ),
      successPayload: (resolvedConfig) => ({
        runtimeModel: resolvedConfig.runtimeModel,
        memoryEnabled: resolvedConfig.memoryEnabled,
        hasGitHubAppConnection: resolvedConfig.hasGitHubAppConnection,
        networkRequestLoggingEnabled: resolvedConfig.networkRequestLoggingEnabled,
        quickMode: resolvedConfig.quickMode
      })
    });

    return {
      snapshot,
      runActorUserId,
      resolvedRunActorIsSuperAdmin,
      envRoot,
      workspaceRoot,
      taskDir,
      liveSyncFiles,
      runStartedAt,
      shellEnvOverrides,
      githubInstallationAccess,
      cancellationMonitor,
      refreshGitHubToken,
      runtimeConfig,
      memoryMainFile: memoryFiles.memoryMainFile,
      projectMemoryMainFile: memoryFiles.projectMemoryMainFile
    };
  } catch (error) {
    cancellationMonitor.stop();
    throw error;
  }
}

interface PreparedRunResourceInput {
  debugLogger: TaskDebugLogger;
  actorUserId: string | null;
  job: TaskExecutionJob;
  snapshot: TaskSnapshot;
  envRoot: string;
  workspaceRoot: string;
  taskDir: string;
  shellEnvOverrides: Record<string, string>;
  runtimeConfig: Awaited<ReturnType<typeof resolveRuntimeConfig>>;
  resolvedRunActorIsSuperAdmin: boolean;
}

interface PreparedRunResources {
  runToolOptions: TaskMessageToolOptions;
  onDemandSkills: string[];
  runShellMaxTimeoutSeconds: number;
  isSubtask: boolean;
  skillsRootDir: string | null;
  activeMcpConnections: Map<string, McpConnection>;
  activeSkillTools: FunctionTool[];
  sandbox: PersistentSandbox;
  initializeSandbox: () => Promise<{ alreadyInitialized: boolean }>;
  skillManager: Awaited<ReturnType<typeof buildSkillManager>>;
}

async function resolvePreparedRunTooling(input: PreparedRunResourceInput) {
  const runToolOptions = resolveRunToolOptions(input.snapshot, input.job, input.runtimeConfig.memoryEnabled);
  const project = {
    workspaceId: input.snapshot.task.workspace_id,
    environmentId: input.snapshot.task.environment_id
  };
  const [googleWorkspaceReferences, hasGoogleWorkspaceFolders] = await Promise.all([
    listProjectGoogleWorkspaceReferences(project),
    hasTaskGoogleWorkspaceFolders({ ...project, taskId: input.snapshot.task.id })
  ]);
  // Attached Google files make the Google Workspace skill available, but its large toolset loads
  // only when the agent enables it.
  const onDemandSkills = (googleWorkspaceReferences.length > 0 || hasGoogleWorkspaceFolders)
    && !runToolOptions.enabledSkills.includes(GOOGLE_WORKSPACE_SKILL_ID)
    && isSkillEnabledByConfig(config, GOOGLE_WORKSPACE_SKILL_ID)
    ? [GOOGLE_WORKSPACE_SKILL_ID]
    : [];
  const skillsRootDir = config.skills?.rootDir ?? null;
  const hasSourceDependentSkill = skillsRootDir !== null && [...runToolOptions.enabledSkills, ...onDemandSkills].some((skillId) => (
    getSkillEntry(skillsRootDir, skillId)?.manifest.sourceAccess !== undefined
  ));
  await input.debugLogger.log("Resolved run tool options.", {
    stage: "startup.tool_options",
    phase: "success",
    scheduleTask: runToolOptions.scheduleTask,
    subtasks: runToolOptions.subtasks,
    webSearch: runToolOptions.webSearch,
    memorySearch: runToolOptions.memorySearch,
    computerUse: runToolOptions.computerUse,
    interactiveCanvas: runToolOptions.interactiveCanvas,
    enabledSkillCount: runToolOptions.enabledSkills.length,
    enabledSourceCount: runToolOptions.enabledSources.length
  });
  return {
    runToolOptions,
    runShellMaxTimeoutSeconds: Math.max(1, Math.floor(input.snapshot.shell_tool_max_timeout_ms / 1000)),
    isSubtask: input.snapshot.task.parent_task_id !== null,
    skillsRootDir,
    hasSourceDependentSkill,
    onDemandSkills,
    googleWorkspaceReferences,
    activeMcpConnections: new Map<string, McpConnection>(),
    activeSkillTools: [] as FunctionTool[]
  };
}

async function probePreparedSandboxFilesystem(
  input: PreparedRunResourceInput,
  sandbox: PersistentSandbox
): Promise<void> {
  if (input.runtimeConfig.quickMode || !await isTaskDebugModeEnabled()) {
    return;
  }
  try {
    const probe = await sandbox.executeShellCommand({
      shell: "/bin/bash",
      command: [
        "set +e",
        'printf "ENV_ROOT=%s\\n" "$ENV_ROOT"',
        'printf "TASK_DIR=%s\\n" "$TASK_DIR"',
        'printf "[env_root_entries]\\n"',
        'ls -1A "$ENV_ROOT" 2>&1 || true',
        'printf "[context_entries]\\n"',
        'ls -1A "$ENV_ROOT/context" 2>&1 || true'
      ].join("\n"),
      workingDir: input.taskDir,
      env: {
        TASK_DIR: input.taskDir,
        ENV_ROOT: input.envRoot,
        WORKSPACE_ROOT: input.workspaceRoot,
        HOME: input.envRoot,
        PWD: input.taskDir,
        ...input.shellEnvOverrides
      },
      timeoutMs: 5_000,
      maxOutputKb: 64
    });
    await input.debugLogger.log("Probed sandbox filesystem visibility.", {
      stage: "startup.sandbox.fs_probe",
      phase: "success",
      exitCode: probe.exitCode,
      stdout: probe.stdout,
      stderr: probe.stderr
    });
  } catch (error) {
    await input.debugLogger.log("Failed to probe sandbox filesystem visibility.", {
      stage: "startup.sandbox.fs_probe",
      phase: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function createPreparedRunSandbox(
  input: PreparedRunResourceInput,
  tooling: Awaited<ReturnType<typeof resolvePreparedRunTooling>>
) {
  const sandboxInput = {
    debugLogger: input.debugLogger,
    actorUserId: input.actorUserId,
    baseEnvironmentJsonPayload: input.runtimeConfig.baseEnvironmentJsonPayload,
    forceNetworkEnabled: tooling.runToolOptions.enabledSources.length > 0 || tooling.hasSourceDependentSkill,
    envRoot: input.envRoot,
    isThreadTask: input.snapshot.task.is_thread,
    skillsRootDir: tooling.skillsRootDir,
    taskDir: input.taskDir,
    taskId: input.job.taskId,
    runId: input.job.runId,
    workspaceId: input.snapshot.task.workspace_id,
    environmentId: input.snapshot.task.environment_id,
    workspaceRoot: input.workspaceRoot,
    workflowType: input.snapshot.task.workflow_type,
    workflowTaskId: input.snapshot.task.workflow_parent_task_id ?? input.snapshot.task.id,
    workspaceRunAsRoot: input.snapshot.environment.workspace_run_as_root === true,
    envOverrides: input.shellEnvOverrides
  };
  const create = () => createSandbox(sandboxInput);
  const sandboxController = createRecoverableSandboxController({
    create,
    initial: input.runtimeConfig.quickMode ? null : await input.debugLogger.stage({
      stage: "startup.sandbox",
      startMessage: "Creating task sandbox.",
      successMessage: "Created task sandbox.",
      run: create,
      successPayload: {
        taskDir: input.taskDir,
        networkEnabled:
          tooling.runToolOptions.enabledSources.length > 0
          || tooling.hasSourceDependentSkill
          || getSandboxNetworkEnabled(input.runtimeConfig.baseEnvironmentJsonPayload),
        runAsRoot: input.snapshot.environment.workspace_run_as_root === true
      }
    }),
    onRecovered: (recovery) => input.debugLogger.log("Replaced crashed task sandbox.", {
      stage: "sandbox.recovery",
      phase: "success",
      detail: recovery.message
    })
  });
  await probePreparedSandboxFilesystem(input, sandboxController.sandbox);
  return sandboxController;
}

async function buildPreparedRunResources(input: PreparedRunResourceInput): Promise<PreparedRunResources> {
  const tooling = await resolvePreparedRunTooling(input);
  const {
    runToolOptions,
    onDemandSkills,
    runShellMaxTimeoutSeconds,
    isSubtask,
    skillsRootDir,
    googleWorkspaceReferences,
    activeMcpConnections,
    activeSkillTools
  } = tooling;
  const sandboxController = await createPreparedRunSandbox(input, tooling);
  const sandbox = sandboxController.sandbox;
  const skillManager = await input.debugLogger.stage({
    stage: "startup.skill_manager",
    startMessage: "Preparing skill manager.",
    successMessage: "Prepared skill manager.",
    run: () => buildSkillManager({
      activeMcpConnections,
      activeSkillTools,
      actorUserId: input.actorUserId,
      mcpTimeoutMs: input.snapshot.mcp_timeout_ms,
      resolvedRunActorIsSuperAdmin: input.resolvedRunActorIsSuperAdmin,
      sandbox,
      skillsRootDir,
      taskId: input.job.taskId,
      taskDir: input.taskDir,
      canvas: input.snapshot.interactive_canvas
        ? {
            id: input.snapshot.interactive_canvas.id,
            absolutePath: path.resolve(input.envRoot, input.snapshot.interactive_canvas.root_path),
            entryPath: input.snapshot.interactive_canvas.entry_path
          }
        : null,
      workspaceId: input.snapshot.task.workspace_id,
      workspaceRoot: input.workspaceRoot,
      googleWorkspaceReferences
    }),
    successPayload: {
      skillsRootConfigured: skillsRootDir !== null
    }
  });

  return {
    runToolOptions,
    onDemandSkills,
    runShellMaxTimeoutSeconds,
    isSubtask,
    skillsRootDir,
    activeMcpConnections,
    activeSkillTools,
    sandbox,
    initializeSandbox: sandboxController.initializeSandbox,
    skillManager
  };
}

async function cleanupPreparedRunResources(input: {
  cancellationMonitor: TaskCancellationMonitor | null;
  skillManager: Awaited<ReturnType<typeof buildSkillManager>> | null;
  sandbox: PersistentSandbox | null;
  mountRelease?: () => Promise<void>;
}): Promise<void> {
  input.cancellationMonitor?.stop();
  if (input.skillManager) {
    await input.skillManager.cleanupMcpConnections();
  }
  if (input.sandbox) {
    await input.sandbox.stop();
  }
  await input.mountRelease?.();
}

export async function prepareAgentRunContext(
  job: TaskExecutionJob,
  debugLogger: TaskDebugLogger = createTaskDebugLogger(job.taskId)
): Promise<PreparedAgentRunContext> {
  let base: Awaited<ReturnType<typeof resolvePreparedRunBase>> | null = null;
  let sandbox: PersistentSandbox | null = null;
  let cancellationMonitor: TaskCancellationMonitor | null = null;
  let skillManager: Awaited<ReturnType<typeof buildSkillManager>> | null = null;
  const mountRelease = () => releaseTaskSourceMounts({
    userId: base?.runActorUserId ?? null,
    taskId: job.taskId,
    workspaceId: base?.snapshot.task.workspace_id ?? "internal"
  }).catch(() => undefined);

  try {
    if (!(await setTaskStatusForRun(job.taskId, job.runId, "starting"))) {
      throw new Error("TASK_CANCELLED");
    }
    await debugLogger.log("Task entered startup preparation.", {
      stage: "startup.status",
      phase: "success",
      status: "starting",
      runId: job.runId,
      mode: job.mode ?? "default"
    });
    base = await resolvePreparedRunBase(job, debugLogger);
    const resources = await buildPreparedRunResources({
      debugLogger,
      actorUserId: base.runActorUserId,
      job,
      snapshot: base.snapshot,
      envRoot: base.envRoot,
      workspaceRoot: base.workspaceRoot,
      taskDir: base.taskDir,
      shellEnvOverrides: base.shellEnvOverrides,
      runtimeConfig: base.runtimeConfig,
      resolvedRunActorIsSuperAdmin: base.resolvedRunActorIsSuperAdmin
    });
    sandbox = resources.sandbox;
    cancellationMonitor = base.cancellationMonitor;
    skillManager = resources.skillManager;
    await debugLogger.log("Prepared agent runtime resources.", {
      stage: "startup.complete",
      phase: "success",
      liveSyncFileCount: base.liveSyncFiles.length,
      activeSkillToolCount: resources.activeSkillTools.length
    });

    return {
      snapshot: base.snapshot,
      runActorUserId: base.runActorUserId,
      resolvedRunActorIsSuperAdmin: base.resolvedRunActorIsSuperAdmin,
      envRoot: base.envRoot,
      workspaceRoot: base.workspaceRoot,
      taskDir: base.taskDir,
      liveSyncFiles: base.liveSyncFiles,
      runStartedAt: base.runStartedAt,
      baseEnvironmentJsonPayload: base.runtimeConfig.baseEnvironmentJsonPayload,
      networkRequestLoggingEnabled: base.runtimeConfig.networkRequestLoggingEnabled,
      quickMode: base.runtimeConfig.quickMode,
      shellEnvOverrides: base.shellEnvOverrides,
      hasGitHubAppConnection: base.runtimeConfig.hasGitHubAppConnection,
      githubInstallationAccess: base.githubInstallationAccess,
      refreshGitHubToken: base.refreshGitHubToken,
      runtimeProvider: base.runtimeConfig.runtimeProvider,
      runtimeProviderKind: base.runtimeConfig.runtimeProviderKind,
      runtimeAgentId: base.runtimeConfig.runtimeAgentId,
      isQualityReviewSpecialist: base.runtimeConfig.isQualityReviewSpecialist,
      runtimeModel: base.runtimeConfig.runtimeModel,
      runtimeCompatibilityModes: base.runtimeConfig.runtimeCompatibilityModes,
      runtimeModelType: base.runtimeConfig.runtimeModelType,
      requestedContextManagementVersion: base.runtimeConfig.requestedContextManagementVersion,
      runtimeEnvironmentPayload: base.runtimeConfig.runtimeEnvironmentPayload,
      memoryEnabled: base.runtimeConfig.memoryEnabled,
      thoughtPersistenceEnabled: base.runtimeConfig.thoughtPersistenceEnabled,
      memoryMainFile: base.memoryMainFile,
      projectMemoryMainFile: base.projectMemoryMainFile,
      runtimeModelPayload: base.runtimeConfig.runtimeModelPayload,
      runtimeQuickModel: base.runtimeConfig.runtimeQuickModel,
      runtimeQuickModelCompatibilityModes: base.runtimeConfig.runtimeQuickModelCompatibilityModes,
      maxContextTokens: base.runtimeConfig.maxContextTokens,
      subscriptionUserId: base.runtimeConfig.hasPlatformInitiator ? base.snapshot.task.initiator_user_id : null,
      subscriptionUserIsSuperAdmin: base.snapshot.initiator_user?.is_super_admin === true,
      runPersistedItems: [],
      currentLeafMessageId: base.snapshot.branch_leaf_message_id,
      dispatchState: null,
      runToolOptions: resources.runToolOptions,
      onDemandSkills: resources.onDemandSkills,
      runShellMaxTimeoutSeconds: resources.runShellMaxTimeoutSeconds,
      isSubtask: resources.isSubtask,
      isProjectMaster: base.snapshot.task.is_project_master === true
        && getProjectMasterEnabled(base.snapshot.workspace_model_defaults),
      skillsRootDir: resources.skillsRootDir,
      activeMcpConnections: resources.activeMcpConnections,
      activeSkillTools: resources.activeSkillTools,
      sandbox,
      initializeSandbox: resources.initializeSandbox,
      cancellationMonitor: base.cancellationMonitor,
      enableSkillById: skillManager.enableSkillById,
      enableSourceById: skillManager.enableSourceById,
      emitNetworkRequestLog: createNetworkRequestLogger(job.taskId, base.runtimeConfig.networkRequestLoggingEnabled),
      cleanup: async () => {
        cancellationMonitor!.stop();
        await skillManager!.cleanupMcpConnections();
        await sandbox!.stop();
        await mountRelease();
      }
    };
  } catch (error) {
    await cleanupPreparedRunResources({
      cancellationMonitor: cancellationMonitor ?? base?.cancellationMonitor ?? null,
      skillManager,
      sandbox,
      mountRelease
    });
    throw error;
  }
}
