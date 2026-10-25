import { normalizeWorkspaceFileHost, workspaceFileFeatures, deviceWorkspaceProjectPath, type WorkspaceFileHost } from "@meowbert/shared";
import { loadSubagentRuntime, loadSubagentPlatformProvider } from "../subagents/runtime.js";
import path from "node:path";
import fs from "node:fs/promises";
import type { SubagentRuntime } from "@meowbert/run-executor/subagents/types";
import { loadLaneRuntime } from "../agent-swarm/fork-seed.js";
import { applyLaneModelRoute, loadLaneModelRoute } from "../agent-swarm/model-route.js";
import {
  buildGitHubRuntimeEnv,
  findPlatformAgentPresetById,
  getProjectMasterEnabled,
  getVisiblePlatformAgentPresets,
  getWorkspaceDefaultAgentId,
  normalizeAgentSwarmSettings,
  resolveCompatibilityModesForModel,
  resolveContextManagementVersionForModel,
  resolveEffectiveEnvironmentJsonPayload,
  resolveFastModel,
  resolveModelTypeForModel,
  resolvePlatformAgentPresetMode,
  type PlatformAgentPreset,
  type PlatformUsageBilling,
  type TaskExecutionJob
} from "@meowbert/shared";
import { findStorageBackendById } from "@meowbert/shared/storage-backends";
import { assertSafePublicUrl } from "@meowbert/shared/server-security";
import { query } from "../../lib/db.js";
import { resolveRuntimeAiProvider } from "../agent/runtime-provider.js";
import { mintGitHubRuntimeEnvFromConnection } from "../github/workspace-github-app.js";
import { resolveTaskEnvironmentRoot } from "../runtime/environment-storage.js";
import { resolveTaskWorkspaceRoot } from "../workspaces/workspace-storage.js";
import {
  getTaskSnapshot,
  isUserSuperAdmin,
  listTaskLiveSyncFilesForWorker,
  resolveUserSandboxContainerResources,
  setTaskStatusForRun
} from "../agent-db/index.js";
import type { TaskSnapshot } from "@meowbert/run-executor/agent/types";
import {
  deepMergeJsonObjects,
  extractModelRequestPayload,
  isNetworkRequestLoggingEnabled,
  normalizeEnvironmentJsonPayload,
  pickRunChosenModelRoute,
  pickRunToolOptions
} from "@meowbert/run-executor/agent/utils";
import {
  ensureWorkspaceMemoryWatcher,
  readProjectMemoryMainFile,
  readWorkspaceMemoryMainFile
} from "../memory/index.js";
import { resolveTaskDir } from "@meowbert/run-executor/tasks/task-paths";
import { getMaxContextWindowTokens } from "@meowbert/run-executor/context-compaction/index";
import { providerSupportsNativeCompaction } from "@meowbert/run-executor/context-compaction/shared";
import type { OpenAiProviderConfig } from "@meowbert/run-executor/agent/openai-client";
import { resolveChatGptProvider } from "../agent/chatgpt-auth.js";
import { resolveModelRouterSelection } from "../model-routing/router-resolution.js";
import { resolveProjectMasterTaskAgent } from "@meowbert/run-executor/project-master/task-agent";
import {
  resolveEffectiveRunAgentPreset,
  resolveMemorySynthesisAgentPreset,
  resolveReviewerAgentPreset
} from "@meowbert/run-executor/agent/agent-preset-resolution";
import { resolveAgentTaskInputDir } from "@meowbert/run-executor/agent/task-input-dir";
import { markTaskRunDispatchRunning } from "../tasks/task-run-dispatch.js";
import type { TaskDebugLogger } from "../runtime/debug-task-events.js";
import { hasTaskGoogleWorkspaceFolders, listProjectGoogleWorkspaceReferences } from "../agent-db/google-workspace-references.js";
import type { RunBootstrap, RunGitHubAccess, RunRuntimeRoute } from "@meowbert/run-executor/agent/ports/run-bootstrap";
import type { GitHubTokenRefresh } from "@meowbert/run-executor/agent/ports/platform-tools";
import { listUnfinishedToolCalls } from "./tool-call-records.js";
import { getTaskScheduleInfo } from "../task-schedules/service.js";
import { config } from "../../lib/config.js";
import { loadRunInputManifest } from "./input-manifest.js";

type WorkspaceMemoryMainFile = Awaited<ReturnType<typeof readWorkspaceMemoryMainFile>>;
type ProjectMemoryMainFile = Awaited<ReturnType<typeof readProjectMemoryMainFile>>;

// What the control plane keeps about a run it bootstrapped. The executor gets `bootstrap`; the
// provider, billing and full snapshot stay here.
export interface ServerRunState {
  job: TaskExecutionJob;
  bootstrap: RunBootstrap;
  snapshot: TaskSnapshot;
  provider: OpenAiProviderConfig;
  billing: PlatformUsageBilling | null;
  // Super admins are billed for statistics but never blocked by subscription quota.
  quotaExempt: boolean;
  taskDir: string;
  refreshGitHubToken: () => Promise<GitHubTokenRefresh>;
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

// A swarm leader runs on the leader agent its swarm settings name; without one it keeps the task's agent.
async function resolveAgentSwarmLeaderAgentId(snapshot: TaskSnapshot): Promise<string | null> {
  if (snapshot.task.workflow_type !== "agent_swarm" || snapshot.task.workflow_parent_task_id) {
    return null;
  }

  const result = await query<{ config_json: unknown }>(
    "SELECT config_json FROM task_swarms WHERE task_id = $1",
    [snapshot.task.id]
  );
  return result.rows[0] ? normalizeAgentSwarmSettings(result.rows[0].config_json).leaderAgentId : null;
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
  const swarmAgentId = await resolveAgentSwarmLeaderAgentId(input.snapshot);
  if (!swarmAgentId) {
    return selectedAgentPreset;
  }

  return findPlatformAgentPresetById(input.visibleAgentPresets, swarmAgentId) ?? selectedAgentPreset;
}

async function registerTaskWorkspace(taskId: string, taskDir: string): Promise<void> {
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

function createRefreshGitHubToken(snapshot: TaskSnapshot, abortSignal?: AbortSignal) {
  return async (): Promise<GitHubTokenRefresh> => {
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

        return { ok: true, login: githubConnection.github_login, expiresAt: null, env };
      }

      const minted = await mintGitHubRuntimeEnvFromConnection({
        connection: githubConnection,
        abortSignal
      });
      if (!minted) {
        return { ok: false, error: "GitHub App installation is missing or invalid for this workspace." };
      }

      return {
        ok: true,
        login: minted.login,
        expiresAt: minted.expiresAt,
        contentsPermission: minted.contentsPermission,
        repositorySelection: minted.repositorySelection,
        canReadContents: minted.canReadContents,
        canWriteContents: minted.canWriteContents,
        env: minted.env
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
  taskInputDir: string | null;
  memoryFiles: {
    memoryMainFile: WorkspaceMemoryMainFile | null;
    projectMemoryMainFile: ProjectMemoryMainFile | null;
  };
  runtimeProvider: OpenAiProviderConfig;
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
        abortSignal: input.abortSignal,
        chosenRoute: pickRunChosenModelRoute(input.snapshot.messages)
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

async function loadRoutedLaneRuntime(
  laneTaskId: string,
  routers: TaskSnapshot["platform_model_routers"],
  environmentPayload: Record<string, unknown>
): Promise<SubagentRuntime | null> {
  const runtime = await loadLaneRuntime(laneTaskId);
  return runtime ? applyLaneModelRoute(runtime, await loadLaneModelRoute(laneTaskId), routers, environmentPayload) : null;
}

async function resolveRuntimeConfig(
  job: TaskExecutionJob,
  snapshot: TaskSnapshot,
  resolvedRunActorIsSuperAdmin: boolean,
  debugLogger: TaskDebugLogger,
  taskInputDir: string | null,
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
  // Subagents and swarm lanes run on the model and provider they were started with, or on the
  // router target their swarm parent picked for them.
  const inheritedRuntime = snapshot.task.parent_task_id
    ? await loadSubagentRuntime(job.taskId)
    : snapshot.task.workflow_internal_role === "lane"
      ? await loadRoutedLaneRuntime(job.taskId, snapshot.platform_model_routers, baseEnvironmentJsonPayload)
      : null;
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
  const runtimeQuickModel = usingByoProvider
    ? runtimeModel
    : resolveFastModel({ specializedModels: snapshot.platform_specialized_models, fallbackModel: runtimeModel });
  const route: RunRuntimeRoute = {
    providerKind: usingCustomByo ? "byo" : usingChatGptByo ? "chatgpt" : "platform",
    providerBaseUrl: runtimeProvider.baseUrl,
    chatGptCodex: runtimeProvider.chatGptCodex === true,
    supportsNativeCompaction: providerSupportsNativeCompaction(runtimeProvider),
    agentId: runtimeAgentPreset?.id ?? null,
    isQualityReviewSpecialist,
    model: runtimeModel,
    compatibilityModes: resolveCompatibilityModesForModel(runtimeModel, snapshot.platform_model_metadata),
    modelType: resolveModelTypeForModel(runtimeModel, snapshot.platform_model_metadata),
    // Swarm forks are defined on v2 context windows, so every swarm task uses v2.
    requestedContextManagementVersion: snapshot.task.workflow_type === "agent_swarm"
      ? "v2"
      : resolveContextManagementVersionForModel(runtimeModel, snapshot.platform_model_metadata),
    baseEnvironmentJsonPayload,
    environmentPayload: runtimeEnvironmentPayload,
    modelPayload: extractModelRequestPayload(runtimeEnvironmentPayload),
    quickModel: runtimeQuickModel,
    quickModelCompatibilityModes: resolveCompatibilityModesForModel(
      runtimeQuickModel,
      snapshot.platform_model_metadata
    ),
    maxContextTokens: getMaxContextWindowTokens(runtimeModel, snapshot.platform_model_metadata),
    quickMode,
    networkRequestLoggingEnabled: isNetworkRequestLoggingEnabled(baseEnvironmentJsonPayload)
  };
  return {
    route,
    runtimeProvider,
    hasPlatformInitiator:
      !usingByoProvider
      && typeof snapshot.task.initiator_user_id === "string"
      && snapshot.task.initiator_user_id.length > 0
  };
}

// The model router reads the memory files to judge the request; the executor reads its own copy.
async function readRoutingMemoryFiles(snapshot: TaskSnapshot, workspaceRoot: string) {
  if (snapshot.environment.workspace_memory_enabled !== true) {
    return { memoryMainFile: null, projectMemoryMainFile: null };
  }
  void ensureWorkspaceMemoryWatcher(workspaceRoot);
  const project = { workspaceRoot, projectId: snapshot.environment.id, projectName: snapshot.environment.name };
  const [memoryMainFile, projectMemoryMainFile] = await Promise.all([
    readWorkspaceMemoryMainFile(workspaceRoot).catch(() => null),
    readProjectMemoryMainFile(project).catch(() => null)
  ]);
  return { memoryMainFile, projectMemoryMainFile };
}

async function loadRunRoots(snapshot: TaskSnapshot, debugLogger: TaskDebugLogger) {
  const workspace = await query<{ file_host?: WorkspaceFileHost; storage_backend_id: string }>(
    "SELECT file_host, storage_backend_id FROM workspaces WHERE id = $1", [snapshot.task.workspace_id]
  );
  const fileHost = normalizeWorkspaceFileHost(workspace.rows[0]?.file_host, workspace.rows[0]?.storage_backend_id);
  if (fileHost.kind === "device") return { workspaceRoot: "", envRoot: "", fileHost,
    storageBackendId: "workspace:" + snapshot.task.workspace_id, workspaceRootRelative: "", envRootRelative: deviceWorkspaceProjectPath(snapshot.environment.id) };
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
  const backendResult = await query<{ storage_backend_id: string }>(
    `SELECT storage_backend_id FROM workspaces WHERE id = $1`,
    [snapshot.task.workspace_id]
  ).catch(() => ({ rows: [] as Array<{ storage_backend_id: string }> }));
  const storageBackendId = backendResult.rows[0]?.storage_backend_id ?? null;
  const backend = storageBackendId ? findStorageBackendById(config.storage, storageBackendId) : null;
  const backendBase = backend?.type === "mounted"
    ? backend.mountPath
    : backend?.type === "local"
      ? path.dirname(backend.workspacesRoot)
      : null;
  const canonicalBase = backendBase ? await fs.realpath(backendBase).catch(() => null) : null;
  const relative = (root: string): string | undefined => {
    if (!canonicalBase) return undefined;
    const value = path.relative(canonicalBase, root);
    return value === ".." || value.startsWith(".." + path.sep) || path.isAbsolute(value) ? undefined : value;
  };
  return {
    envRoot,
    workspaceRoot,
    fileHost,
    storageBackendId: storageBackendId ?? undefined,
    envRootRelative: relative(envRoot),
    workspaceRootRelative: relative(workspaceRoot)
  };
}

async function loadRunSnapshotAndActor(job: TaskExecutionJob, debugLogger: TaskDebugLogger) {
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
  const runActorIsSuperAdmin = await resolveRunActorIsSuperAdmin(snapshot, runActorUserId);
  await debugLogger.log("Resolved run actor permissions.", {
    stage: "startup.actor",
    phase: "success",
    actorUserId: runActorUserId,
    actorIsSuperAdmin: runActorIsSuperAdmin
  });
  return { snapshot, runActorUserId, runActorIsSuperAdmin };
}

async function refreshStartupGitHubAccess(
  refreshGitHubToken: () => Promise<GitHubTokenRefresh>,
  snapshot: TaskSnapshot,
  debugLogger: TaskDebugLogger
): Promise<RunGitHubAccess> {
  const result = snapshot.github_connection
    ? await debugLogger.stage({
        stage: "startup.github_token",
        startMessage: "Refreshing GitHub token for startup.",
        successMessage: (refresh) => refresh.ok
          ? "Refreshed GitHub token for startup."
          : "GitHub token refresh failed during startup.",
        run: refreshGitHubToken,
        successPayload: (refresh) => ({
          ok: refresh.ok,
          login: refresh.login ?? null,
          expiresAt: refresh.expiresAt ?? null,
          contentsPermission: refresh.contentsPermission ?? null,
          repositorySelection: refresh.repositorySelection ?? null,
          canReadContents: refresh.canReadContents ?? null,
          canWriteContents: refresh.canWriteContents ?? null,
          error: refresh.error ?? null
        })
      })
    : null;
  return {
    hasConnection: snapshot.github_connection !== null,
    hasAppConnection: snapshot.github_connection !== null,
    installationAccess: result?.ok
      ? {
          contentsPermission: result.contentsPermission ?? null,
          repositorySelection: result.repositorySelection ?? null,
          canReadContents: result.canReadContents === true,
          canWriteContents: result.canWriteContents === true
        }
      : null,
    env: result?.ok ? result.env ?? {} : {}
  };
}

async function loadRunTooling(snapshot: TaskSnapshot, runActorUserId: string | null, fileHost: WorkspaceFileHost) {
  if (!workspaceFileFeatures(fileHost).serverFiles) return { googleWorkspaceReferences: [], hasGoogleWorkspaceFolders: false,
    sandboxResources: await resolveUserSandboxContainerResources(runActorUserId),
    liveSyncFiles: (await listTaskLiveSyncFilesForWorker({ taskId: snapshot.task.id, workspaceId: snapshot.task.workspace_id,
      environmentId: snapshot.task.environment_id, taskRootPath: snapshot.task.task_root_path }))
      .filter((file) => file.provider === "google-drive" && file.linkKind === "folder") };
  const project = {
    workspaceId: snapshot.task.workspace_id,
    environmentId: snapshot.task.environment_id
  };
  const [googleWorkspaceReferences, hasGoogleWorkspaceFolders, sandboxResources, liveSyncFiles] = await Promise.all([
    listProjectGoogleWorkspaceReferences(project),
    hasTaskGoogleWorkspaceFolders({ ...project, taskId: snapshot.task.id }),
    resolveUserSandboxContainerResources(runActorUserId),
    listTaskLiveSyncFilesForWorker({
      taskId: snapshot.task.id,
      workspaceId: snapshot.task.workspace_id,
      environmentId: snapshot.task.environment_id,
      taskRootPath: snapshot.task.task_root_path
    })
  ]);
  return { googleWorkspaceReferences, hasGoogleWorkspaceFolders, sandboxResources, liveSyncFiles };
}

// Admits the run on the control plane: marks it starting, resolves its identity, roots, model
// route and credentials, and records the start. Throws TASK_CANCELLED when the run lost its task.
export async function loadServerRunState(
  job: TaskExecutionJob,
  debugLogger: TaskDebugLogger,
  abortSignal?: AbortSignal
): Promise<ServerRunState> {
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
  const { snapshot, runActorUserId, runActorIsSuperAdmin } = await loadRunSnapshotAndActor(job, debugLogger);
  const roots = await loadRunRoots(snapshot, debugLogger);
  const taskDir = resolveTaskDir(roots.envRoot, snapshot.task.task_root_path);
  if (roots.fileHost.kind === "server") await registerTaskWorkspace(job.taskId, taskDir);
  const tooling = await loadRunTooling(snapshot, runActorUserId, roots.fileHost);
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
  const refreshGitHubToken = createRefreshGitHubToken(snapshot, abortSignal);
  // Minting a GitHub App token is a network call; it only adds GitHub variables to the shell
  // environment, so it runs alongside the model route instead of before it.
  const githubPromise = refreshStartupGitHubAccess(refreshGitHubToken, snapshot, debugLogger);
  githubPromise.catch(() => undefined);
  const memoryFiles = roots.fileHost.kind === "device" ? { memoryMainFile: null, projectMemoryMainFile: null } : await readRoutingMemoryFiles(snapshot, roots.workspaceRoot);
  const runtime = await debugLogger.stage({
    stage: "startup.runtime_config",
    startMessage: "Resolving runtime configuration.",
    successMessage: "Resolved runtime configuration.",
    run: () => resolveRuntimeConfig(
      job,
      snapshot,
      runActorIsSuperAdmin,
      debugLogger,
      roots.fileHost.kind === "device" ? null : resolveAgentTaskInputDir({ taskDir }),
      memoryFiles,
      job.quickMode === true,
      abortSignal
    ),
    successPayload: (resolved) => ({
      runtimeModel: resolved.route.model,
      memoryEnabled: snapshot.environment.workspace_memory_enabled === true,
      hasGitHubAppConnection: snapshot.github_connection !== null,
      networkRequestLoggingEnabled: resolved.route.networkRequestLoggingEnabled,
      quickMode: resolved.route.quickMode
    })
  });
  const github = await githubPromise;
  const sandboxImage = await query<{ sandbox_image_digest: string | null }>(
    `SELECT sandbox_image_digest FROM platform_settings WHERE id = 1`
  ).then((result) => ({
    reference: config.runtime.sandbox.image,
    digest: result.rows[0]?.sandbox_image_digest ?? (config.runtime.sandbox.image.includes("@") ? config.runtime.sandbox.image.split("@")[1] : null)
  })).catch(() => ({
    reference: config.runtime.sandbox.image,
    digest: config.runtime.sandbox.image.includes("@") ? config.runtime.sandbox.image.split("@")[1] : null
  }));
  const memoryEnabled = snapshot.environment.workspace_memory_enabled === true;
  const subscriptionUserId = runtime.hasPlatformInitiator ? snapshot.task.initiator_user_id : null;

  return {
    job,
    snapshot,
    provider: runtime.runtimeProvider,
    billing: subscriptionUserId ? { userId: subscriptionUserId, taskId: job.taskId, runId: job.runId } : null,
    quotaExempt: runActorIsSuperAdmin || snapshot.initiator_user?.is_super_admin === true,
    taskDir,
    refreshGitHubToken,
    bootstrap: {
      fileHost: roots.fileHost,
      snapshot,
      runActorUserId,
      runActorIsSuperAdmin,
      runStartedAt: runStartedAt.toISOString(),
      roots,
      liveSyncFiles: tooling.liveSyncFiles,
      runtime: runtime.route,
      memoryEnabled,
      thoughtPersistenceEnabled: memoryEnabled && snapshot.thought_persistence_enabled === true,
      github,
      sandboxResources: tooling.sandboxResources,
      googleWorkspaceReferences: tooling.googleWorkspaceReferences,
      hasGoogleWorkspaceFolders: tooling.hasGoogleWorkspaceFolders,
      scheduleInfo: await getTaskScheduleInfo(job.taskId),
      isProjectMaster: snapshot.task.is_project_master === true
        && getProjectMasterEnabled(snapshot.workspace_model_defaults),
      projectMasterTaskAgent: snapshot.task.is_project_master === true
        ? resolveProjectMasterTaskAgent(snapshot, runActorIsSuperAdmin)
        : null,
      unfinishedToolCalls: await listUnfinishedToolCalls(job.taskId, job.runId),
      inputs: job.executionTarget?.kind === "local" ? await loadRunInputManifest(job.taskId) : [],
      sandboxImage
    }
  };
}
