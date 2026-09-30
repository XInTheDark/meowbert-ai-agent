import { createDefaultEnvironmentJsonPayload } from "@meowbert/shared";

export const RUN_SHELL_TOOL_NAME = "run_shell";
export const SHELL_SESSION_TOOL_NAME = "shell_session";
export const REFRESH_GH_TOKEN_TOOL_NAME = "refresh_gh_token";
export const FINAL_RESPONSE_TOOL_NAME = "final_response";
export const MARK_ARTIFACT_TOOL_NAME = "mark_artifact";
export const CREATE_INTERACTIVE_CANVAS_TOOL_NAME = "create_interactive_canvas";
export const TASK_TITLE_TOOL_NAME = "set_task_title";
export const VIEW_IMAGE_TOOL_NAME = "view_image";
export const VIEW_PDF_FILE_TOOL_NAME = "view_pdf_file";
export const MEMORY_SEARCH_TOOL_NAME = "memory_search";
export const SEARCH_WEB_TOOL_NAME = "search_web";
export const LIST_LIVE_SYNC_FILES_TOOL_NAME = "list_live_sync_files";
export const GET_LIVE_SYNC_STATUS_TOOL_NAME = "get_live_sync_status";
export const PULL_LIVE_SYNC_FILE_TOOL_NAME = "pull_live_sync_file";
export const PUSH_LIVE_SYNC_FILE_TOOL_NAME = "push_live_sync_file";
export const QUERY_TASKS_TOOL_NAME = "query_tasks";
// Earlier runs recorded calls under this name; dispatch still accepts it for replay.
export const LEGACY_SEARCH_TASK_HISTORY_TOOL_NAME = "search_task_history";
export const VIEW_TASK_HISTORY_TOOL_NAME = "view_task_history";
export const LIST_SKILLS_TOOL_NAME = "list_skills";
export const ENABLE_SKILL_TOOL_NAME = "enable_skill";
export const SCHEDULE_TASK_TOOL_NAME = "schedule_task";
export const EDIT_CURRENT_TASK_SCHEDULE_TOOL_NAME = "edit_current_task_schedule";
export const CREATE_SUBTASK_TOOL_NAME = "create_subtask";
export const START_SUBTASK_TOOL_NAME = "start_subtask";
export const STOP_TASK_TOOL_NAME = "stop_task";
export const WAIT_TOOL_NAME = "wait";
export const SWARM_PAUSE_TOOL_NAME = "swarm_pause";
export const SWARM_MANAGE_TOOL_NAME = "swarm_manage";
export const SWARM_BUDGET_STATUS_TOOL_NAME = "swarm_budget_status";
export const SWARM_SPAWN_NODE_TOOL_NAME = "swarm_spawn_node";
export const SWARM_GRANT_BUDGET_TOOL_NAME = "swarm_grant_budget";
export const SWARM_CANCEL_NODE_TOOL_NAME = "swarm_cancel_node";
export const SWARM_RECORD_REVIEW_TOOL_NAME = "swarm_record_review";
export const SWARM_RECORD_FINAL_REVIEW_TOOL_NAME = "swarm_record_final_review";
export const START_LONG_HORIZON_TASK_TOOL_NAME = "start_long_horizon_task";
export const REQUEST_CLARIFICATION_TOOL_NAME = "request_clarification";
export const SUBMIT_RESPONSE_TOOL_NAME = "submit_response";
export const SUBMIT_REVIEW_TOOL_NAME = "submit_review";
export const REFRESH_INBOX_TOOL_NAME = "refresh_inbox";
export const LIST_CHANNELS_TOOL_NAME = "list_channels";
export const READ_CHANNEL_TOOL_NAME = "read_channel";
export const CREATE_CHANNEL_TOOL_NAME = "create_channel";
export const SEND_CHANNEL_MESSAGE_TOOL_NAME = "send_channel_message";
export const SUBMIT_SWARM_OUTPUT_TOOL_NAME = "submit_swarm_output";
export const APPLY_PATCH_TOOL_NAME = "apply_patch";
export const INIT_SANDBOX_TOOL_NAME = "init_sandbox";
export const CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME = "context_checkpoint_and_compact";
export const CONTEXT_CHECKPOINT_AND_TRIM_TOOL_NAME = "context_checkpoint_and_trim";
export const NEW_CONTEXT_TOOL_NAME = "new_context";
export const GET_CONTEXT_REMAINING_TOOL_NAME = "get_context_remaining";
export const HISTORY_LIST_WINDOWS_TOOL_NAME = "history_list_windows";
export const HISTORY_LIST_ITEMS_TOOL_NAME = "history_list_items";
export const HISTORY_READ_ITEM_TOOL_NAME = "history_read_item";
export const HISTORY_SEARCH_CONTENTS_TOOL_NAME = "history_search_contents";
export const NOTES_LIST_FILES_BY_PREFIX_TOOL_NAME = "notes_list_files_by_prefix";
export const NOTES_READ_FILE_TOOL_NAME = "notes_read_file";
export const NOTES_SEARCH_CONTENTS_TOOL_NAME = "notes_search_contents";
export const NOTES_APPEND_TO_FILE_TOOL_NAME = "notes_append_to_file";
export const NOTES_WRITE_FILE_TOOL_NAME = "notes_write_file";

export const DEFAULT_MAX_CONTEXT_WINDOW_TOKENS = 256_000;
export const RUN_SHELL_DEFAULT_OUTPUT_LIMIT_CHARS = 20_000;
export const RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS = 10_000;
export const RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS = 10_000;
export const RUN_SHELL_MIN_TIMEOUT_SECONDS = 1;
export const RUN_SHELL_MAX_TIMEOUT_SECONDS = 86_400;
export const VIEW_PDF_DEFAULT_PAGE_START = 1;
export const VIEW_PDF_DEFAULT_PAGE_END = 50;
export const VIEW_PDF_MAX_PAGE_WINDOW = 50;

export const DEFAULT_ENVIRONMENT_JSON_PAYLOAD: Record<string, unknown> = createDefaultEnvironmentJsonPayload();

export const TASK_TITLE_SYSTEM_PROMPT = [
  "ONLY generate a task title.",
  "Given the user's first message, output a concise task title with at most 10 words.",
  "Do not answer the user's request or provide instructions.",
  "Summarize the full intent of the task as far as possible.",
  "Return title text only with no quotes, markdown, or trailing punctuation."
].join(" ");

export interface ResponseToolAvailability {
  // Claude models cannot use the hosted web_search tool on a subscription; they get search_web instead.
  useClaudeWebSearch?: boolean;
  requireSwarmTarget?: boolean;
  newMessageOrganizationEnabled?: boolean;
  allowFinalResponse?: boolean;
  allowScheduleTools?: boolean;
  allowSubtaskTools?: boolean;
  allowComputerUse?: boolean;
  allowComputerLocalShell?: boolean;
  allowComputerVisualTools?: boolean;
  allowPdfFileTool?: boolean;
  allowTaskHistoryTools?: boolean;
  allowProjectMasterTools?: boolean;
  allowLiveSyncTools?: boolean;
  allowInteractiveCanvasTools?: boolean;
  allowStopTask?: boolean;
  allowWaitTool?: boolean;
  allowSwarmPauseTool?: boolean;
  allowSwarmManageTool?: boolean;
  allowSwarmBudgetTools?: boolean;
  allowSwarmReviewTool?: boolean;
  allowSwarmFinalReviewTool?: boolean;
  allowSwarmOutputTool?: boolean;
  allowRefreshGitHubToken?: boolean;
  allowStartLongHorizonTask?: boolean;
  allowRequestClarification?: boolean;
  allowSubmitResponse?: boolean;
  allowSubmitReview?: boolean;
  allowSwarmTools?: boolean;
  runShellMaxTimeoutSeconds?: number;
  quickModeActive?: boolean;
  allowContextManagementTools?: boolean;
  contextManagementVersion?: "v1" | "v2";
  contextRecoveryPhase?: "normal" | "needs_note" | "needs_reset";
  allowPersistentShellSessions?: boolean;
}
