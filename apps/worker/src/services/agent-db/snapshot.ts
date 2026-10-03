import { config } from "../../lib/config.js";
import { query } from "../../lib/db.js";
import type { EnvironmentRow, TaskMessageRow, TaskRow, TaskSnapshot } from "../agent/types.js";
import { ensureTaskHistoryWarm } from "../tasks/task-history.js";
import {
  resolveWorkspaceClaudeCacheKeepalive,
  resolveWorkspaceCodeModeEnabled,
  resolveWorkspaceCompactionBackend,
  resolveWorkspaceContextManagementToolsEnabled,
  resolveWorkspaceMcpTimeoutMs,
  resolveWorkspaceModelRequestTimeoutMs,
  resolveWorkspaceSendMetadataToModel,
  resolveWorkspaceShellToolMaxTimeoutMs
} from "../workspaces/workspace-model-settings.js";
import {
  getWorkspaceThoughtPersistenceEnabled,
  DEFAULT_MEMORY_ENABLED,
  normalizePlatformAgentPresets,
  normalizePlatformModelMetadata,
  normalizePlatformModelRouters,
  normalizePlatformSpecializedModels,
  resolveInternalModel,
  type PlatformSpecializedModels
} from "@meowbert/shared";
import { getNewestLeafMessageId, loadBranchPathMessages } from "./messages.js";

type GitHubConnectionSnapshot = TaskSnapshot["github_connection"];

async function loadGitHubAppConnectionForTask(taskId: string): Promise<GitHubConnectionSnapshot> {
  const result = await query<{
    app_id: string;
    app_slug: string;
    private_key_pem: string;
    installation_id: string;
    default_org: string | null;
  }>(
    `SELECT wga.app_id::text,
            wga.app_slug,
            wga.private_key_pem,
            wga.installation_id::text,
            wga.default_org
       FROM workspace_github_apps wga
       JOIN tasks t
         ON t.workspace_id = wga.workspace_id
      WHERE t.id = $1
        AND wga.installation_id IS NOT NULL`,
    [taskId]
  );

  const connection = result.rows[0];
  return connection
    ? {
        type: "app",
        ...connection
      }
    : null;
}

async function hasLegacyGitHubConnectionTable(): Promise<boolean> {
  const result = await query<{ table_name: string | null }>(
    `SELECT to_regclass('workspace_github_connections')::text AS table_name`
  );

  return result.rows[0]?.table_name !== null;
}

async function loadLegacyGitHubConnectionForTask(taskId: string): Promise<GitHubConnectionSnapshot> {
  if (!(await hasLegacyGitHubConnectionTable())) {
    return null;
  }

  const result = await query<{
    github_login: string;
    github_name: string | null;
    github_email: string | null;
    access_token: string;
    default_org: string | null;
  }>(
    `SELECT wgc.github_login,
            wgc.github_name,
            wgc.github_email,
            wgc.access_token,
            wgc.default_org
       FROM workspace_github_connections wgc
       JOIN tasks t
         ON t.workspace_id = wgc.workspace_id
      WHERE t.id = $1`,
    [taskId]
  );

  const connection = result.rows[0];
  return connection
    ? {
        type: "oauth",
        ...connection
      }
    : null;
}

async function loadGitHubConnectionForTask(taskId: string): Promise<GitHubConnectionSnapshot> {
  return (await loadGitHubAppConnectionForTask(taskId))
    ?? (await loadLegacyGitHubConnectionForTask(taskId));
}

async function loadTaskSnapshotBase(taskId: string) {
  const [taskRes, envRes, settingsRes, platformSettingsRes, githubConnectionRes, initiatorUserRes] = await Promise.all([
    query<TaskRow>(
      `SELECT tasks.id,
              tasks.title,
              tasks.workspace_id,
              tasks.environment_id,
              tasks.status,
              tasks.source,
              tasks.initiator_user_id,
              tasks.connector_context_id,
              tasks.default_timezone,
              tasks.max_steps_override,
              tasks.time_limit_seconds,
              tasks.time_limit_deadline_at,
              tasks.allow_waiting,
              tasks.parent_task_id,
              tasks.subtask_depth,
              tasks.task_root_path,
              (tt.task_id IS NOT NULL) AS is_thread,
              EXISTS (SELECT 1 FROM project_masters pm WHERE pm.task_id = tasks.id) AS is_project_master,
              tt.parent_task_id AS thread_parent_task_id,
              tt.parent_message_id AS thread_parent_message_id,
              tt.selected_text AS thread_selected_text,
              tasks.workflow_type,
              tasks.workflow_parent_task_id,
              tasks.workflow_internal_role,
              tasks.interactive_canvas_id,
              tasks.interactive_canvas_intent
         FROM tasks
         LEFT JOIN task_threads tt ON tt.task_id = tasks.id
        WHERE tasks.id = $1`,
      [taskId]
    ),
    query<EnvironmentRow>(
      `SELECT e.id,
              e.name,
              e.root_path,
              e.json_payload,
              w.root_path AS workspace_root_path,
              COALESCE(ws.memory_enabled, ${DEFAULT_MEMORY_ENABLED}) AS workspace_memory_enabled,
              COALESCE(ws.run_as_root, false) AS workspace_run_as_root
         FROM environments e
         JOIN tasks t ON t.environment_id = e.id
         JOIN workspaces w ON w.id = t.workspace_id
         LEFT JOIN workspace_settings ws ON ws.workspace_id = t.workspace_id
        WHERE t.id = $1`,
      [taskId]
    ),
    query<{ model_defaults_json: Record<string, unknown> }>(
      `SELECT ws.model_defaults_json
         FROM workspace_settings ws
         JOIN tasks t ON t.workspace_id = ws.workspace_id
        WHERE t.id = $1`,
      [taskId]
    ),
    query<{
      agent_presets_json: unknown;
      model_metadata_json: unknown;
      model_routers_json: unknown;
      specialized_models_json: unknown;
      enable_prompt_caching: boolean;
    }>(
      `SELECT agent_presets_json,
              model_metadata_json,
              model_routers_json,
              specialized_models_json,
              enable_prompt_caching
         FROM platform_settings
        WHERE id = 1`
    ),
    loadGitHubConnectionForTask(taskId),
    query<{
      id: string;
      is_super_admin: boolean;
      byo_enabled: boolean;
      byo_provider: string | null;
      byo_base_url: string | null;
      byo_api_key: string | null;
      byo_model: string | null;
    }>(
      `SELECT u.id,
              u.is_super_admin,
              u.byo_enabled,
              u.byo_provider,
              u.byo_base_url,
              u.byo_api_key,
              u.byo_model
         FROM tasks t
         JOIN users u ON u.id = t.initiator_user_id
        WHERE t.id = $1`,
      [taskId]
    )
  ]);

  if ((taskRes.rowCount ?? 0) === 0 || (envRes.rowCount ?? 0) === 0) {
    throw new Error(`Task not found: ${taskId}`);
  }

  return {
    task: taskRes.rows[0],
    environment: envRes.rows[0],
    modelDefaults: settingsRes.rows[0]?.model_defaults_json ?? {},
    platformSettings: platformSettingsRes.rows[0] ?? null,
    githubConnection: githubConnectionRes,
    initiatorUser: initiatorUserRes.rows[0] ?? null
  };
}

async function loadEffectiveBranchMessages(taskId: string, branchMessageId?: string | null): Promise<{
  effectiveBranchLeaf: string | null;
  messages: TaskMessageRow[];
}> {
  let effectiveBranchLeaf = branchMessageId ?? (await getNewestLeafMessageId(taskId));
  let messages: TaskMessageRow[] = [];

  if (effectiveBranchLeaf) {
    messages = await loadBranchPathMessages(taskId, effectiveBranchLeaf);
  }

  if (messages.length === 0 && branchMessageId) {
    const fallbackLeaf = await getNewestLeafMessageId(taskId);
    effectiveBranchLeaf = fallbackLeaf;
    if (fallbackLeaf) {
      messages = await loadBranchPathMessages(taskId, fallbackLeaf);
    }
  }

  return { effectiveBranchLeaf, messages };
}

function resolveSnapshotRuntimeSettings(modelDefaults: Record<string, unknown>, specializedModels: PlatformSpecializedModels) {
  const workspaceModel = typeof modelDefaults.defaultModel === "string" ? modelDefaults.defaultModel : null;
  return {
    model: workspaceModel ?? resolveInternalModel({ specializedModels, fallbackModel: config.openai.defaultModel }),
    model_request_timeout_ms: resolveWorkspaceModelRequestTimeoutMs(modelDefaults),
    shell_tool_max_timeout_ms: resolveWorkspaceShellToolMaxTimeoutMs(modelDefaults),
    mcp_timeout_ms: resolveWorkspaceMcpTimeoutMs(modelDefaults),
    compaction_backend: resolveWorkspaceCompactionBackend(modelDefaults),
    context_management_tools_enabled: resolveWorkspaceContextManagementToolsEnabled(modelDefaults)
  };
}

export async function getTaskSnapshot(taskId: string, branchMessageId?: string | null): Promise<TaskSnapshot> {
  await ensureTaskHistoryWarm(taskId);
  const [base, branch] = await Promise.all([
    loadTaskSnapshotBase(taskId),
    loadEffectiveBranchMessages(taskId, branchMessageId)
  ]);
  const specializedModels = normalizePlatformSpecializedModels(base.platformSettings?.specialized_models_json ?? null);
  const runtimeSettings = resolveSnapshotRuntimeSettings(base.modelDefaults, specializedModels);

  const interactiveCanvas = base.task.interactive_canvas_id
    ? (await query<{
        id: string;
        name: string;
        slug: string;
        root_path: string;
        entry_path: string;
        runtime_mode: "static" | "dev_server";
      }>(
        `SELECT id,
                name,
                slug,
                root_path,
                entry_path,
                runtime_mode
           FROM project_canvases
          WHERE id = $1
            AND workspace_id = $2
            AND environment_id = $3
          LIMIT 1`,
        [base.task.interactive_canvas_id, base.task.workspace_id, base.task.environment_id]
      )).rows[0] ?? null
    : null;

  return {
    task: base.task,
    initiator_user: base.initiatorUser,
    environment: base.environment,
    interactive_canvas: interactiveCanvas,
    workspace_model_defaults: base.modelDefaults,
    messages: branch.messages,
    branch_leaf_message_id: branch.effectiveBranchLeaf,
    thought_persistence_enabled: getWorkspaceThoughtPersistenceEnabled(base.modelDefaults),
    send_metadata_to_model: resolveWorkspaceSendMetadataToModel(base.modelDefaults),
    ...runtimeSettings,
    enable_prompt_caching: base.platformSettings?.enable_prompt_caching ?? true,
    claude_cache_keepalive: resolveWorkspaceClaudeCacheKeepalive(base.modelDefaults),
    code_mode_enabled: resolveWorkspaceCodeModeEnabled(base.modelDefaults),
    platform_agent_presets: normalizePlatformAgentPresets(base.platformSettings?.agent_presets_json ?? null),
    platform_model_metadata: normalizePlatformModelMetadata(base.platformSettings?.model_metadata_json ?? null),
    platform_model_routers: normalizePlatformModelRouters(base.platformSettings?.model_routers_json ?? null),
    platform_specialized_models: specializedModels,
    github_connection: base.githubConnection
  };
}
