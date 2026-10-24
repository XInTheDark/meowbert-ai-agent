import type { ComputerToolName, ConversationMap, DesktopComputerExecutorResult, DesktopComputerStatus } from "@meowbert/shared";
import type { TaskHistoryMessage, TaskHistorySearchInput, TaskHistorySearchResult, TaskMessageToolOptions } from "../types.js";
import type {
  TaskLiveSyncFolderSearchFilters,
  TaskLiveSyncFolderSearchResult,
  TaskLiveSyncStatus
} from "../live-sync-types.js";

type JsonRecord = Record<string, unknown>;

// Tools whose state lives on the control plane. The control plane runs them with the run's own
// identity (task, project, workspace, acting user); arguments carry only what the agent chose.
// The executor records the call, its events and its result; these only return the output.
export interface PlatformToolHost {
  queryTasks(filters: TaskHistorySearchInput): Promise<TaskHistorySearchResult>;
  viewTaskHistory(input: { taskId: string; maxMessages: number }): Promise<ViewedTaskHistory | null>;
  readOrganizedTaskHistory(input: {
    args: OrganizedHistoryArguments;
    branchLeafId: string | null;
    allowOtherTasks: boolean;
    staged: OrganizationStagedState | null;
  }): Promise<JsonRecord>;
  searchMemory(input: {
    query: string;
    limit: number;
    scope: "all" | "workspace" | "current_project";
    paths: string[] | null;
  }): Promise<MemorySearchOutput>;

  createRecurringTask(input: {
    message: string;
    mode: "scheduled" | "infinite";
    repeat: string | null;
    timezone: string | null;
    enabledTools: AgentEnabledTools | null;
    currentToolOptions: TaskMessageToolOptions;
  }): Promise<CreatedRecurringTask>;
  editCurrentTaskSchedule(input: {
    repeat: string | null;
    timezone: string | null;
    enabledTools: AgentEnabledTools | null;
  }): Promise<RecurringScheduleState>;
  pauseRecurringSchedule(): Promise<RecurringScheduleState>;
  applyInfiniteWait(seconds: number): Promise<string>;

  createSubtask(input: {
    message: string;
    title: string | null;
    enabledTools: AgentEnabledTools | null;
    fallbackToolOptions: TaskMessageToolOptions;
  }): Promise<CreatedSubtask>;
  startSubtasks(input: { taskIds: string[]; timeoutSeconds: number | null }): Promise<StartedSubtasks>;

  liveSyncStatus(input: { taskRelativePath: string }): Promise<TaskLiveSyncStatus>;
  liveSyncTransfer(input: { action: "pull" | "push"; taskRelativePath: string; force?: boolean }): Promise<TaskLiveSyncStatus>;
  liveSyncFolderSearch(input: {
    taskRelativePath: string;
    subfolder: string | null;
    depth: number;
    filters: TaskLiveSyncFolderSearchFilters;
  }): Promise<TaskLiveSyncFolderSearchResult>;

  createProjectCanvas(input: { name: string; entryPath: string }): Promise<CreatedProjectCanvas>;
  recordProjectCanvasEntry(input: { canvasId: string; entryPath: string }): Promise<void>;
  markArtifacts(input: { artifacts: Array<{ relativePath: string; size: number }> }): Promise<void>;
  unmarkArtifacts(input: { relativePaths: string[] }): Promise<void>;

  refreshGitHubToken(): Promise<GitHubTokenRefresh>;
  // Proxy credentials a skill's MCP server uses to read a connected source for this run.
  issueSourceAccess(input: {
    sourceId: string;
    provider: string;
    ticketScope: "source_proxy" | "source_reference_proxy";
  }): Promise<Record<string, string>>;

  getDesktopComputerPresence(): Promise<DesktopComputerPresence | null>;
  requestDesktopComputerAction(input: {
    toolName: ComputerToolName;
    args: JsonRecord;
    timeoutMs?: number;
  }): Promise<DesktopComputerExecutorResult>;

  persistentShell(input: PersistentShellRequest): Promise<JsonRecord>;
  readShellSessionWaitState(input: { sessionId: string }): Promise<ShellSessionWaitState>;
}

export type PlatformToolName = keyof PlatformToolHost;

// Tool choices the agent passes on to a task it creates.
export interface AgentEnabledTools {
  web_search?: boolean | null;
  memory_search?: boolean | null;
  schedule_task?: boolean | null;
  subtasks?: boolean | null;
  computer_use?: boolean | null;
  enabled_skills?: string[] | null;
}

export interface DesktopComputerPresence {
  sessionId: string;
  connectedAt: string;
  lastSeenAt: string;
  status: DesktopComputerStatus;
}

export interface MemorySearchOutput {
  sync_status: {
    state: string;
    search_target: string;
    active_generation: string | null;
    detail: string | null;
    error: string | null;
    last_started_at: string | null;
    last_successful_at: string | null;
    updated_at: string | null;
  };
  items: Array<{
    id: string;
    score: number;
    text: string;
    file_path: string;
    relative_path: string;
    line_start: number | null;
    line_end: number | null;
  }>;
}

export interface ViewedTaskHistory {
  task_id: string;
  title: string | null;
  status: string;
  files: string[];
  messages: TaskHistoryMessage[];
}

export interface OrganizedHistoryArguments {
  task_id?: string | null;
  max_messages?: number | null;
  view?: "messages" | "navigation" | null;
  cursor?: string | null;
  branch_leaf_id?: string | null;
  message_ids?: string[] | null;
}

export interface OrganizationStagedState {
  outline: string | null;
  graph: ConversationMap | null;
  outlineChanged: boolean;
  mapChanged: boolean;
}

export interface RecurringScheduleState {
  mode: "scheduled" | "infinite";
  state: "active" | "paused" | "cancelled";
  repeat: string | null;
  timezone: string;
  nextRunAt: string | null;
}

export interface CreatedRecurringTask {
  taskId: string;
  runId: string;
  mode: "scheduled" | "infinite";
  scheduleState: "active";
  repeat: string | null;
  timezone: string;
  nextRunAt: string | null;
}

export interface CreatedSubtask {
  taskId: string;
  title: string | null;
  status: string;
  subtaskDepth: number;
  taskRootPath: string;
  createdAt: string;
}

export interface StartedSubtasks {
  ok: boolean;
  timed_out: boolean;
  timeout_seconds: number;
  subtasks: Array<{
    task_id: string;
    title: string | null;
    status: string;
    completed_at: string | null;
    final_response: string | null;
    exit_reason: string | null;
    error_summary: string | null;
    timed_out: boolean;
  }>;
}

export interface CreatedProjectCanvas {
  id: string;
  name: string;
  rootPath: string;
  entryPath: string;
}

export interface GitHubTokenRefresh {
  ok: boolean;
  login?: string;
  expiresAt?: string | null;
  contentsPermission?: string | null;
  repositorySelection?: string | null;
  canReadContents?: boolean;
  canWriteContents?: boolean;
  error?: string;
  // Shell variables to merge into the run's environment when the refresh succeeds.
  env?: Record<string, string>;
}

// Cloud project shells outlive runs in server-owned containers; local shells belong to the run container.
// Each action returns the output the agent sees.
export type PersistentShellRequest =
  | { action: "list" }
  | { action: "status"; sessionId: string; tailLines?: number | null; saveOutputPath?: string | null }
  | { action: "start"; command?: string | null; mode?: "terminal" | "pipe" | null; lifetimeSeconds?: number | null; envOverrides: Record<string, string> }
  | { action: "stop"; sessionId: string }
  | {
      action: "control";
      sessionId: string;
      control: "input" | "interrupt" | "eof" | "resize";
      data?: string | null;
      cols?: number | null;
      rows?: number | null;
    }
  | { action: "run"; sessionId: string; command: string; force: boolean; envOverrides: Record<string, string> };

// What an in-run wait watches on a persistent shell session.
export interface ShellSessionWaitState {
  sessionId: string;
  status: string;
  commandId: string | null;
  exitCode: number | null;
  output: string;
  outputTruncated: boolean;
  outputVersion: string | null;
  stopReason: string | null;
}
