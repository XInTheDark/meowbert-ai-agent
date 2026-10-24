import type { FunctionTool, ResponseInputItem } from "openai/resources/responses/responses";
import path from "node:path";
import {
  getSandboxNetworkEnabled,
  isSkillEnabledByConfig,
  isSourceManifest,
  WORKSPACE_DEFAULT_TOOLSET_CANVAS_SKILL_ID as CANVAS_SKILL_ID,
  type PlatformModelCompatibilityMode,
  type PlatformModelType,
  type TaskExecutionJob
} from "@meowbert/shared";
import type { DockerSandboxHandle } from "@meowbert/shared/docker-sandbox";
import {
  startMcpServer,
  listMcpTools,
  mcpToolsToFunctionTools,
  skillToolPrefix,
  stopMcpServer,
  type McpConnection
} from "./mcp-client.js";
import { getSkillEntry, getSkillDoc } from "./skill-registry.js";
import type { TaskSnapshot } from "./types.js";
import { mergeTaskToolOptions, pickRunToolOptions } from "./utils.js";
import {
  buildWorkspaceMemoryEnvVars,
  ensureProjectMemoryDir,
  ensureWorkspaceMemoryDir,
  readProjectMemoryMainFile,
  readWorkspaceMemoryMainFile
} from "../memory/main-files.js";
import { resolveTaskDir } from "../tasks/task-paths.js";
import type { ToolDispatchState } from "../agent-tool-dispatch/index.js";
import type { TaskMessageToolOptions } from "./types.js";
import { startTaskCancellationMonitor, type TaskCancellationMonitor } from "./cancellation.js";
import { ensureTaskWorkspace } from "../runtime/shell.js";
import type { ProjectMasterTaskAgent } from "../project-master/task-agent.js";
import { buildSkillRuntimeEnv } from "./skill-runtime.js";
import type { TaskLiveSyncFileSummary } from "./live-sync-types.js";
import { createRunDebugLogger, type TaskDebugLogger } from "./run-debug-logger.js";
import {
  GOOGLE_WORKSPACE_SKILL_ID,
  serializeGoogleWorkspaceReferences,
  type GoogleWorkspaceRuntimeReference
} from "./google-workspace-references.js";
import type { RunBootstrap } from "./ports/run-bootstrap.js";
import type { RunControl, RunToolCallStart } from "./ports/run-control.js";
import type { ModelGateway } from "./ports/model-gateway.js";
import type { MachineHost } from "./ports/machine-host.js";
import type { RunEnvironment } from "./ports/run-environment.js";
import type { ExecutorSettings } from "./ports/executor-settings.js";
import type { RunFeatures } from "./ports/run-features.js";
import type { GitHubTokenRefresh } from "./ports/platform-tools.js";

type WorkspaceMemoryMainFile = Awaited<ReturnType<typeof readWorkspaceMemoryMainFile>>;
type ProjectMemoryMainFile = Awaited<ReturnType<typeof readProjectMemoryMainFile>>;

type EnableSkillById = (skillId: string) => Promise<{ doc: string | null; toolNames: string[] }>;
type EnableSourceById = (sourceId: string) => Promise<{ doc: string | null; toolNames: string[] }>;

export interface PreparedAgentRunContext {
  control: RunControl;
  models: ModelGateway;
  machine: MachineHost;
  settings: ExecutorSettings;
  features: RunFeatures;
  snapshot: TaskSnapshot;
  runActorUserId: string | null;
  resolvedRunActorIsSuperAdmin: boolean;
  envRoot: string;
  workspaceRoot: string;
  taskDir: string;
  taskScratchDir: string;
  liveSyncFiles: TaskLiveSyncFileSummary[];
  runStartedAt: Date;
  baseEnvironmentJsonPayload: Record<string, unknown>;
  networkRequestLoggingEnabled: boolean;
  quickMode: boolean;
  shellEnvOverrides: Record<string, string>;
  hasGitHubAppConnection: boolean;
  githubInstallationAccess: RunBootstrap["github"]["installationAccess"];
  refreshGitHubToken?: () => Promise<Omit<GitHubTokenRefresh, "env">>;
  runtimeProviderKind: "platform" | "byo" | "chatgpt";
  runtimeProviderBaseUrl: string;
  chatGptCodex: boolean;
  supportsNativeCompaction: boolean;
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
  runPersistedItems: ResponseInputItem[];
  currentLeafMessageId: string | null;
  dispatchState: ToolDispatchState | null;
  runToolOptions: TaskMessageToolOptions;
  // Skills offered to the agent without loading their tools up front; it enables them on demand.
  onDemandSkills: string[];
  runShellMaxTimeoutSeconds: number;
  isSubtask: boolean;
  isProjectMaster?: boolean;
  // Set only for Master runs: the agent its tasks run on.
  projectMasterTaskAgent?: ProjectMasterTaskAgent | null;
  // Tool calls an earlier run of the task started and never finished.
  unfinishedToolCalls: RunToolCallStart[];
  scheduleInfo: RunBootstrap["scheduleInfo"];
  skillsRootDir: string | null;
  activeMcpConnections: Map<string, McpConnection>;
  activeSkillTools: FunctionTool[];
  sandbox: DockerSandboxHandle;
  initializeSandbox: () => Promise<{ alreadyInitialized: boolean }>;
  cancellationMonitor: TaskCancellationMonitor;
  enableSkillById: EnableSkillById;
  enableSourceById: EnableSourceById;
  cleanup: (dispatchState: ToolDispatchState | null) => Promise<void>;
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
    memoryMainFile = await readWorkspaceMemoryMainFile(workspaceRoot);
    projectMemoryMainFile = await readProjectMemoryMainFile({ workspaceRoot, projectId, projectName });
  }
  Object.assign(shellEnvOverrides, buildWorkspaceMemoryEnvVars(workspaceRoot, memoryEnabled, projectId));
  return { memoryMainFile, projectMemoryMainFile };
}

export function resolveRunToolOptions(snapshot: TaskSnapshot, job: TaskExecutionJob, memoryEnabled: boolean): TaskMessageToolOptions {
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
  // Canvas is one feature: the old Interactive Canvas option and an attached canvas both mean the Canvas skill.
  const wantsCanvas = runToolOptions.interactiveCanvas === true || snapshot.interactive_canvas !== null;
  if (wantsCanvas && !runToolOptions.enabledSkills.includes(CANVAS_SKILL_ID)) {
    runToolOptions.enabledSkills = [...runToolOptions.enabledSkills, CANVAS_SKILL_ID];
  }

  return runToolOptions;
}

interface SkillManagerInput {
  control: RunControl;
  activeMcpConnections: Map<string, McpConnection>;
  activeSkillTools: FunctionTool[];
  mcpTimeoutMs: number;
  resolvedRunActorIsSuperAdmin: boolean;
  sandbox: DockerSandboxHandle;
  skillsRootDir: string | null;
  skillConfig: ExecutorSettings["skills"];
  sandboxSkillsRootDir?: string;
  taskDir: string;
  canvas?: {
    id: string;
    absolutePath: string;
    entryPath: string;
  } | null;
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
      input.sandboxSkillsRootDir ? path.posix.join(input.sandboxSkillsRootDir, path.basename(entry.skillDir)) : entry.skillDir,
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

// Source access goes through the control plane's source proxy, so the credentials are minted there.
async function buildSourceAccessEnv(input: SkillManagerInput, sourceId: string, provider: string, ticketScope: "source_proxy" | "source_reference_proxy") {
  return {
    ...await input.control.platform.issueSourceAccess({ sourceId, provider, ticketScope }),
    MEOWBERT_TASK_DIR: input.taskDir,
    MEOWBERT_WORKSPACE_ROOT: input.workspaceRoot
  };
}

function createSkillEnabler(
  input: SkillManagerInput,
  enableManifestEntry: (manifestId: string, runtimeEnv?: Record<string, string>) => Promise<EnabledManifestEntry>
): EnableSkillById {
  return async (skillId) => {
    if (!isSkillEnabledByConfig({ skills: input.skillConfig }, skillId)) {
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
        ...await buildSourceAccessEnv(input, entry.manifest.sourceAccess.sourceId, sourceEntry.manifest.source.provider, "source_reference_proxy"),
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
    const runtimeEnv = await buildSourceAccessEnv(input, sourceId, entry.manifest.source.provider, "source_proxy");
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

function buildSkillManager(input: SkillManagerInput) {
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

function buildInitialShellEnvironment(
  snapshot: TaskSnapshot,
  envRoot: string,
  workspaceRoot: string,
  taskScratchDir: string
): Record<string, string> {
  const shellEnvOverrides: Record<string, string> = {
    WORKSPACE_ROOT: workspaceRoot,
    MEOWBERT_WORKSPACE_ROOT: workspaceRoot,
    TASK_SCRATCH_DIR: taskScratchDir
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

// The refreshed GitHub variables go into the run's shell environment; the agent sees the rest.
function createRefreshGitHubToken(control: RunControl, shellEnvOverrides: Record<string, string>) {
  return async (): Promise<Omit<GitHubTokenRefresh, "env">> => {
    const { env, ...result } = await control.platform.refreshGitHubToken();
    if (result.ok && env) {
      Object.assign(shellEnvOverrides, env);
    }
    return result;
  };
}

async function prepareTaskDirectories(
  env: RunEnvironment,
  bootstrap: RunBootstrap,
  debugLogger: TaskDebugLogger
) {
  const { snapshot, roots } = bootstrap;
  const taskDir = resolveTaskDir(roots.envRoot, snapshot.task.task_root_path);
  await debugLogger.stage({
    stage: "startup.task_workspace",
    startMessage: "Preparing task workspace.",
    successMessage: "Prepared task workspace.",
    run: () => ensureTaskWorkspace(taskDir, roots.envRoot),
    successPayload: { taskDir }
  });
  const taskScratchDir = await debugLogger.stage({
    stage: "startup.task_scratch",
    startMessage: "Preparing task scratch directory.",
    successMessage: "Prepared task scratch directory.",
    run: () => env.machines.prepareScratchDir({ workspaceId: snapshot.task.workspace_id, taskId: snapshot.task.id }),
    successPayload: (resolvedScratchDir) => ({ taskScratchDir: resolvedScratchDir })
  });
  return { taskDir, taskScratchDir };
}

function resolveRunTooling(bootstrap: RunBootstrap, job: TaskExecutionJob, settings: ExecutorSettings) {
  const runToolOptions = resolveRunToolOptions(bootstrap.snapshot, job, bootstrap.memoryEnabled);
  // Attached Google files make the Google Workspace skill available, but its large toolset loads
  // only when the agent enables it.
  const onDemandSkills = (bootstrap.googleWorkspaceReferences.length > 0 || bootstrap.hasGoogleWorkspaceFolders)
    && !runToolOptions.enabledSkills.includes(GOOGLE_WORKSPACE_SKILL_ID)
    && isSkillEnabledByConfig(settings, GOOGLE_WORKSPACE_SKILL_ID)
    ? [GOOGLE_WORKSPACE_SKILL_ID]
    : [];
  const skillsRootDir = settings.skills?.rootDir ?? null;
  const hasSourceDependentSkill = skillsRootDir !== null && [...runToolOptions.enabledSkills, ...onDemandSkills].some((skillId) => (
    getSkillEntry(skillsRootDir, skillId)?.manifest.sourceAccess !== undefined
  ));
  return { runToolOptions, onDemandSkills, skillsRootDir, hasSourceDependentSkill };
}

async function probeSandboxFilesystem(input: {
  bootstrap: RunBootstrap;
  machine: MachineHost;
  taskDir: string;
  shellEnvOverrides: Record<string, string>;
  debugLogger: TaskDebugLogger;
  control: RunControl;
}): Promise<void> {
  const { envRoot, workspaceRoot } = input.bootstrap.roots;
  if (input.bootstrap.runtime.quickMode || !await input.control.isDebugEnabled()) {
    return;
  }
  try {
    const probe = await input.machine.sandbox.executeShellCommand({
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
        ENV_ROOT: envRoot,
        WORKSPACE_ROOT: workspaceRoot,
        HOME: envRoot,
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

function startPreparedCancellationMonitor(control: RunControl, snapshot: TaskSnapshot): TaskCancellationMonitor {
  return startTaskCancellationMonitor(control, {
    timeLimitDeadlineAt: snapshot.task.time_limit_deadline_at
  });
}

interface PreparedRunState {
  env: RunEnvironment;
  job: TaskExecutionJob;
  bootstrap: RunBootstrap;
  debugLogger: TaskDebugLogger;
  cancellationMonitor: TaskCancellationMonitor;
  taskDir: string;
  taskScratchDir: string;
  shellEnvOverrides: Record<string, string>;
  memoryFiles: Awaited<ReturnType<typeof prepareWorkspaceMemory>>;
}

async function startRunMachine(state: PreparedRunState, tooling: ReturnType<typeof resolveRunTooling>): Promise<MachineHost> {
  const { bootstrap, job, env } = state;
  const { snapshot, roots } = bootstrap;
  const machine = await env.machines.start({
    taskId: job.taskId,
    runId: job.runId,
    workspaceId: snapshot.task.workspace_id,
    environmentId: snapshot.task.environment_id,
    actorUserId: bootstrap.runActorUserId,
    taskDir: state.taskDir,
    taskScratchDir: state.taskScratchDir,
    envRoot: roots.envRoot,
    workspaceRoot: roots.workspaceRoot,
    workspaceRootRelative: roots.workspaceRootRelative,
    envRootRelative: roots.envRootRelative,
    isThreadTask: snapshot.task.is_thread,
    skillsRootDir: tooling.skillsRootDir,
    networkEnabled: tooling.runToolOptions.enabledSources.length > 0
      || tooling.hasSourceDependentSkill
      || getSandboxNetworkEnabled(bootstrap.runtime.baseEnvironmentJsonPayload),
    runAsRoot: snapshot.environment.workspace_run_as_root === true,
    resources: bootstrap.sandboxResources,
    env: state.shellEnvOverrides,
    startEagerly: !bootstrap.runtime.quickMode,
    log: (message, payload) => state.debugLogger.log(message, payload)
  });
  await probeSandboxFilesystem({
    bootstrap,
    machine,
    taskDir: state.taskDir,
    shellEnvOverrides: state.shellEnvOverrides,
    debugLogger: state.debugLogger,
    control: env.control
  });
  return machine;
}

function assemblePreparedContext(
  state: PreparedRunState,
  tooling: ReturnType<typeof resolveRunTooling>,
  machine: MachineHost,
  skillManager: ReturnType<typeof buildSkillManager>,
  skillTooling: { activeMcpConnections: Map<string, McpConnection>; activeSkillTools: FunctionTool[] }
): PreparedAgentRunContext {
  const { bootstrap, env } = state;
  const { snapshot, runtime } = bootstrap;
  return {
    control: env.control,
    models: env.models,
    machine,
    settings: env.settings,
    features: env.features,
    snapshot,
    runActorUserId: bootstrap.runActorUserId,
    resolvedRunActorIsSuperAdmin: bootstrap.runActorIsSuperAdmin,
    envRoot: bootstrap.roots.envRoot,
    workspaceRoot: bootstrap.roots.workspaceRoot,
    taskDir: state.taskDir,
    taskScratchDir: state.taskScratchDir,
    liveSyncFiles: bootstrap.liveSyncFiles,
    runStartedAt: new Date(bootstrap.runStartedAt),
    baseEnvironmentJsonPayload: runtime.baseEnvironmentJsonPayload,
    networkRequestLoggingEnabled: runtime.networkRequestLoggingEnabled,
    quickMode: runtime.quickMode,
    shellEnvOverrides: state.shellEnvOverrides,
    hasGitHubAppConnection: bootstrap.github.hasAppConnection,
    githubInstallationAccess: bootstrap.github.installationAccess,
    refreshGitHubToken: bootstrap.github.hasConnection
      ? createRefreshGitHubToken(env.control, state.shellEnvOverrides)
      : undefined,
    runtimeProviderKind: runtime.providerKind,
    runtimeProviderBaseUrl: runtime.providerBaseUrl,
    chatGptCodex: runtime.chatGptCodex,
    supportsNativeCompaction: runtime.supportsNativeCompaction,
    runtimeAgentId: runtime.agentId,
    isQualityReviewSpecialist: runtime.isQualityReviewSpecialist,
    runtimeModel: runtime.model,
    runtimeCompatibilityModes: runtime.compatibilityModes,
    runtimeModelType: runtime.modelType,
    requestedContextManagementVersion: runtime.requestedContextManagementVersion,
    runtimeEnvironmentPayload: runtime.environmentPayload,
    memoryEnabled: bootstrap.memoryEnabled,
    thoughtPersistenceEnabled: bootstrap.thoughtPersistenceEnabled,
    memoryMainFile: state.memoryFiles.memoryMainFile,
    projectMemoryMainFile: state.memoryFiles.projectMemoryMainFile,
    runtimeModelPayload: runtime.modelPayload,
    runtimeQuickModel: runtime.quickModel,
    runtimeQuickModelCompatibilityModes: runtime.quickModelCompatibilityModes,
    maxContextTokens: runtime.maxContextTokens,
    runPersistedItems: [],
    currentLeafMessageId: snapshot.branch_leaf_message_id,
    dispatchState: null,
    runToolOptions: tooling.runToolOptions,
    onDemandSkills: tooling.onDemandSkills,
    runShellMaxTimeoutSeconds: Math.max(1, Math.floor(snapshot.shell_tool_max_timeout_ms / 1000)),
    isSubtask: snapshot.task.parent_task_id !== null,
    isProjectMaster: bootstrap.isProjectMaster,
    projectMasterTaskAgent: bootstrap.projectMasterTaskAgent,
    unfinishedToolCalls: bootstrap.unfinishedToolCalls,
    scheduleInfo: bootstrap.scheduleInfo,
    skillsRootDir: tooling.skillsRootDir,
    activeMcpConnections: skillTooling.activeMcpConnections,
    activeSkillTools: skillTooling.activeSkillTools,
    sandbox: machine.sandbox,
    initializeSandbox: () => machine.initialize(),
    cancellationMonitor: state.cancellationMonitor,
    enableSkillById: skillManager.enableSkillById,
    enableSourceById: skillManager.enableSourceById,
    cleanup: async () => {
      state.cancellationMonitor.stop();
      await skillManager.cleanupMcpConnections();
      await machine.stop();
    }
  };
}

async function prepareRunFromBootstrap(state: PreparedRunState): Promise<PreparedAgentRunContext> {
  const { bootstrap, job, debugLogger } = state;
  const tooling = resolveRunTooling(bootstrap, job, state.env.settings);
  await debugLogger.log("Resolved run tool options.", {
    stage: "startup.tool_options",
    phase: "success",
    scheduleTask: tooling.runToolOptions.scheduleTask,
    subtasks: tooling.runToolOptions.subtasks,
    webSearch: tooling.runToolOptions.webSearch,
    memorySearch: tooling.runToolOptions.memorySearch,
    computerUse: tooling.runToolOptions.computerUse,
    interactiveCanvas: tooling.runToolOptions.interactiveCanvas,
    enabledSkillCount: tooling.runToolOptions.enabledSkills.length,
    enabledSourceCount: tooling.runToolOptions.enabledSources.length
  });
  const machine = await startRunMachine(state, tooling);
  try {
    const skillTooling = { activeMcpConnections: new Map<string, McpConnection>(), activeSkillTools: [] as FunctionTool[] };
    const interactiveCanvas = bootstrap.snapshot.interactive_canvas;
    const skillManager = buildSkillManager({
      control: state.env.control,
      ...skillTooling,
      mcpTimeoutMs: bootstrap.snapshot.mcp_timeout_ms,
      resolvedRunActorIsSuperAdmin: bootstrap.runActorIsSuperAdmin,
      sandbox: machine.sandbox,
      skillsRootDir: tooling.skillsRootDir,
      skillConfig: state.env.settings.skills,
      sandboxSkillsRootDir: state.env.settings.sandboxSkillsRootDir,
      taskDir: state.taskDir,
      canvas: interactiveCanvas
        ? {
            id: interactiveCanvas.id,
            absolutePath: path.resolve(bootstrap.roots.envRoot, interactiveCanvas.root_path),
            entryPath: interactiveCanvas.entry_path
          }
        : null,
      workspaceRoot: bootstrap.roots.workspaceRoot,
      googleWorkspaceReferences: bootstrap.googleWorkspaceReferences
    });
    await debugLogger.log("Prepared agent runtime resources.", {
      stage: "startup.complete",
      phase: "success",
      liveSyncFileCount: bootstrap.liveSyncFiles.length,
      activeSkillToolCount: skillTooling.activeSkillTools.length
    });
    return assemblePreparedContext(state, tooling, machine, skillManager, skillTooling);
  } catch (error) {
    await machine.stop();
    throw error;
  }
}

export async function prepareAgentRunContext(
  job: TaskExecutionJob,
  env: RunEnvironment,
  debugLogger: TaskDebugLogger = createRunDebugLogger(env.control)
): Promise<PreparedAgentRunContext> {
  const bootstrap = await env.control.bootstrap();
  const { snapshot, roots } = bootstrap;
  const { taskDir, taskScratchDir } = await prepareTaskDirectories(env, bootstrap, debugLogger);
  const shellEnvOverrides = {
    ...buildInitialShellEnvironment(snapshot, roots.envRoot, roots.workspaceRoot, taskScratchDir),
    ...bootstrap.github.env
  };
  const cancellationMonitor = startPreparedCancellationMonitor(env.control, snapshot);
  await debugLogger.log("Started cancellation monitor.", {
    stage: "startup.cancellation_monitor",
    phase: "success",
    hasTimeLimitDeadline: snapshot.task.time_limit_deadline_at !== null
  });
  try {
    const memoryFiles = await debugLogger.stage({
      stage: "startup.workspace_memory",
      startMessage: "Preparing workspace memory.",
      successMessage: "Prepared workspace memory.",
      run: () => prepareWorkspaceMemory(
        roots.workspaceRoot,
        snapshot.environment.id,
        snapshot.environment.name,
        bootstrap.memoryEnabled,
        shellEnvOverrides
      ),
      successPayload: (memoryFilesResult) => ({
        memoryEnabled: bootstrap.memoryEnabled,
        memoryMainFilePath: memoryFilesResult.memoryMainFile?.path ?? null,
        memoryMainFileTruncated: memoryFilesResult.memoryMainFile?.truncated ?? false,
        projectMemoryMainFilePath: memoryFilesResult.projectMemoryMainFile?.path ?? null,
        projectMemoryMainFileTruncated: memoryFilesResult.projectMemoryMainFile?.truncated ?? false
      })
    });
    return await prepareRunFromBootstrap({
      env,
      job,
      bootstrap,
      debugLogger,
      cancellationMonitor,
      taskDir,
      taskScratchDir,
      shellEnvOverrides,
      memoryFiles
    });
  } catch (error) {
    cancellationMonitor.stop();
    throw error;
  }
}
