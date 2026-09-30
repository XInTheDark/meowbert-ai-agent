import type {
  PlatformAgentPreset,
  PlatformModelMetadata,
  PlatformModelRouter,
  PlatformSpecializedModels,
  TaskSource,
  TaskStatus,
  TaskWorkflowType
} from "@meowbert/shared";
import type {
  TaskHistoryConcreteTaskType as SharedTaskHistoryConcreteTaskType,
  TaskHistoryPagination as SharedTaskHistoryPagination,
  TaskHistoryScope as SharedTaskHistoryScope,
  TaskHistorySearchInput as SharedTaskHistorySearchInput,
  TaskHistorySortBy as SharedTaskHistorySortBy,
  TaskHistorySortDir as SharedTaskHistorySortDir,
  TaskHistoryTaskType as SharedTaskHistoryTaskType
} from "@meowbert/shared/task-history-search";
import type { WorkspaceCompactionBackend, WorkspaceImageDetail } from "../workspaces/workspace-model-settings.js";

export interface TaskMessageRow {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content_json: Record<string, unknown>;
  message_metadata_json?: Record<string, unknown> | null;
  parent_message_id: string | null;
  edited_from_message_id: string | null;
  created_at: string;
}

export interface TaskRow {
  id: string;
  title: string | null;
  workspace_id: string;
  environment_id: string;
  status: TaskStatus;
  source: TaskSource;
  initiator_user_id: string | null;
  connector_context_id: string | null;
  default_timezone: string;
  max_steps_override: number | null;
  time_limit_seconds: number | null;
  time_limit_deadline_at: string | null;
  allow_waiting: boolean;
  parent_task_id: string | null;
  subtask_depth: number;
  task_root_path: string;
  is_thread: boolean;
  is_project_master?: boolean;
  thread_parent_task_id: string | null;
  thread_parent_message_id: string | null;
  thread_selected_text: string | null;
  workflow_type: TaskWorkflowType | null;
  workflow_parent_task_id: string | null;
  workflow_internal_role: "leader" | "worker" | "reviewer" | null;
  interactive_canvas_id: string | null;
  interactive_canvas_intent: "create" | "update" | "view" | null;
}

export interface TaskMessageToolOptions {
  webSearch: boolean;
  memorySearch: boolean;
  scheduleTask: boolean;
  subtasks: boolean;
  computerUse: boolean;
  interactiveCanvas?: boolean;
  enabledSkills: string[];
  enabledSources: string[];
}

export interface EnvironmentRow {
  id: string;
  name?: string | null;
  root_path: string;
  json_payload: unknown;
  workspace_root_path: string;
  workspace_memory_enabled: boolean;
  workspace_run_as_root: boolean;
}

export interface TaskInteractiveCanvas {
  id: string;
  name: string;
  slug: string;
  root_path: string;
  entry_path: string;
  runtime_mode: "static" | "dev_server";
}

export interface TaskSnapshot {
  task: TaskRow;
  initiator_user: {
    id: string;
    is_super_admin: boolean;
    byo_enabled: boolean;
    byo_provider: string | null;
    byo_base_url: string | null;
    byo_api_key: string | null;
    byo_model: string | null;
  } | null;
  environment: EnvironmentRow;
  interactive_canvas: TaskInteractiveCanvas | null;
  workspace_model_defaults: Record<string, unknown>;
  messages: TaskMessageRow[];
  branch_leaf_message_id: string | null;
  thought_persistence_enabled: boolean;
  send_metadata_to_model: boolean;
  model: string;
  model_request_timeout_ms: number;
  shell_tool_max_timeout_ms: number;
  mcp_timeout_ms: number;
  image_detail?: WorkspaceImageDetail;
  compaction_backend: WorkspaceCompactionBackend;
  context_management_tools_enabled: boolean;
  enable_prompt_caching: boolean;
  claude_cache_keepalive: boolean;
  platform_agent_presets: PlatformAgentPreset[];
  platform_model_metadata: PlatformModelMetadata;
  platform_model_routers: PlatformModelRouter[];
  platform_specialized_models: PlatformSpecializedModels;
  github_connection: (
    | {
        type: "app";
        app_id: string;
        app_slug: string;
        private_key_pem: string;
        installation_id: string;
        default_org: string | null;
      }
    | {
        type: "oauth";
        github_login: string;
        github_name: string | null;
        github_email: string | null;
        access_token: string;
        default_org: string | null;
      }
  ) | null;
}

export type TaskHistoryScope = SharedTaskHistoryScope;
export type TaskHistorySortBy = SharedTaskHistorySortBy;
export type TaskHistorySortDir = SharedTaskHistorySortDir;
export type TaskHistoryTaskType = SharedTaskHistoryTaskType;

export interface TaskHistoryResult {
  task_id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  trashed_at: string | null;
  task_type: SharedTaskHistoryConcreteTaskType;
  schedule_state: "active" | "paused" | "cancelled" | null;
  schedule_next_run_at: string | null;
  schedule_timezone: string | null;
  schedule_repeat_cron: string | null;
  folder_id: string | null;
  latest_update: string | null;
  listening?: boolean;
}

export type TaskHistoryPagination = SharedTaskHistoryPagination;
export type TaskHistorySearchInput = SharedTaskHistorySearchInput;

export interface TaskHistorySearchResult {
  tasks: TaskHistoryResult[];
  pagination: TaskHistoryPagination;
}

export interface TaskHistoryMessage {
  role: string;
  text: string;
  created_at: string;
}
