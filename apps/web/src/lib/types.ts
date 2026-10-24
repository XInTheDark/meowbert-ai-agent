import { THEME_MODE_VALUES, type ThemeMode } from "@meowbert/shared/themes";
import type { AgentSwarmAdvancedSettings } from "@meowbert/shared/agent-swarm-config";
import type { TaskSearchPreview } from "@meowbert/shared/task-history-search";
import type { TaskMessageDisplay } from "@meowbert/shared/task-message-display";
import type { WorkspaceIconKey } from "@meowbert/shared/workspace-icons";
import { ApiClient } from "./api";

export { THEME_MODE_VALUES };
export type { ThemeMode };
export type AuthMode = "login" | "register";
export type FlashTone = "success" | "error";
export type ShellConnectionState = "disconnected" | "connecting" | "connected" | "closed";
export type TaskType = "standard" | "scheduled" | "infinite" | "timed" | "long_horizon" | "agent_swarm";
export type TaskWorkflowType = "long_horizon" | "agent_swarm";
export type TaskWorkflowComposerType = "standard" | TaskWorkflowType | "deep_research" | "quality_control";
export type ProjectCanvasIntent = "create" | "update" | "view";

export interface FlashMessage {
  tone: FlashTone;
  text: string;
}

export interface UserProfile {
  id: string;
  email: string;
  display_name?: string | null;
  is_super_admin?: boolean;
  byo_enabled?: boolean;
  byo_provider?: "openai_compatible" | "chatgpt_oauth" | null;
  byo_forced_model?: string | null;
  onboarding_completed_at?: string | null;
  theme_preference?: ThemeMode | null;
  task_page_preferences?: TaskPagePreferences | null;
}

export interface TaskAssistantMessageDisplayPreferences {
  collapseLongMessages: boolean;
  renderMarkdown: boolean;
  renderCommonHtml: boolean;
  hideCitationMarkers: boolean;
  renderUserMessages: boolean;
  renderLatex: boolean;
  allowSingleDollarLatex: boolean;
  showThoughts: boolean;
  showMessageSummaries: boolean;
  showScrollToBottomButton: boolean;
  showSelectionThreadActions: boolean;
  showSelectionThreadHighlights: boolean;
}

export interface TaskUiPreferences {
  enableThreadsPopup: boolean;
  sendWithShiftEnter: boolean;
}

export interface TaskPagePreferences {
  assistantMessageDisplay: TaskAssistantMessageDisplayPreferences;
  ui: TaskUiPreferences;
}

export type WorkspaceRole = "owner" | "member";

export interface Workspace {
  id: string;
  name: string;
  iconKey?: WorkspaceIconKey;
  role: WorkspaceRole;
  root_path?: string;
  memberCount?: number;
  /** A super admin viewing a workspace they are not a member of. */
  visiting?: boolean;
}

export interface WorkspaceInviteActor {
  id: string;
  email: string;
  displayName: string | null;
}

export interface WorkspacePendingInvite {
  id: string;
  invitedUserId: string;
  email: string;
  displayName: string | null;
  invitedAt: string;
  invitedBy: WorkspaceInviteActor;
}

export interface WorkspaceInviteSummary {
  id: string;
  workspaceId: string;
  workspaceName: string;
  invitedAt: string;
  owner: WorkspaceInviteActor;
  invitedBy: WorkspaceInviteActor;
}

export interface WorkspaceInviteDetail extends WorkspaceInviteSummary {
  workspaceCreatedAt: string;
  memberCount: number;
  projectCount: number;
  environmentCount: number;
  storage: StorageSummary | null;
}

export interface WorkspaceMember {
  id: string;
  email: string;
  displayName: string | null;
  role: WorkspaceRole;
  joinedAt: string;
  isActive: boolean;
  signupApprovalStatus: "approved" | "pending" | "rejected";
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  status: "active" | "archived" | "error";
  json_payload?: Record<string, unknown>;
  root_path?: string;
  created_at?: string;
  updated_at?: string;
}

export type Environment = Project;

export interface TaskSummary {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  trashed_at?: string | null;
  is_publicly_shared?: boolean;
  task_type?: TaskType;
  schedule_state?: "active" | "paused" | "cancelled" | null;
  schedule_next_run_at?: string | null;
  schedule_timezone?: string | null;
  schedule_repeat_cron?: string | null;
  task_root_path?: string;
  folder_id?: string | null;
  folder_sort_order?: number | string | null;
  searchPreview?: TaskSearchPreview | null;
}

export interface TaskListPagination {
  page: number;
  pageSize: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  totalItems: number | null;
  totalPages: number | null;
}

export interface TaskListResponse {
  items: TaskSummary[];
  pagination: TaskListPagination;
}

export interface GlobalTaskSearchResult extends TaskSummary {
  workspace_id: string;
  workspace_name: string;
  project_id: string;
  project_name: string;
}

export interface GlobalTaskSearchResponse {
  items: GlobalTaskSearchResult[];
  pagination: TaskListPagination;
}

export interface TaskFolderSummary {
  id: string;
  workspaceId: string;
  projectId: string;
  environmentId: string;
  parentFolderId: string | null;
  name: string;
  sortOrder: number;
  directTaskCount: number;
  childFolderCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFolderListResponse {
  folders: TaskFolderSummary[];
}

export interface TaskMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content_json: Record<string, unknown>;
  message_metadata_json?: Record<string, unknown> | null;
  author?: {
    id: string;
    email: string;
    display_name: string | null;
  } | null;
  parent_message_id: string | null;
  edited_from_message_id: string | null;
  created_at: string;
  display?: TaskMessageDisplay;
}

export interface TaskDetail {
  task: {
    id: string;
    title: string | null;
    status: string;
    workspace_id?: string;
    project_id?: string;
    environment_id?: string;
    cancellation_requested?: boolean;
    resume_after_interrupt?: boolean;
    created_at: string;
    updated_at: string;
    completed_at?: string | null;
    trashed_at?: string | null;
    is_incognito?: boolean;
    is_publicly_shared?: boolean;
    public_shared_at?: string | null;
    source: string;
    parent_task_id?: string | null;
    subtask_depth?: number;
    task_root_path?: string;
    execution_target?: import("@meowbert/shared").TaskExecutionTarget;
    pending_reason?: string | null;
    is_thread?: boolean;
    is_project_master?: boolean;
    thread_parent_task_id?: string | null;
    thread_parent_message_id?: string | null;
    thread_selected_text?: string | null;
    thread_agent_id?: string | null;
    task_type?: TaskType;
    // An Agent Swarm from before lanes: readable, but it cannot be continued.
    is_legacy_swarm?: boolean;
    default_timezone?: string;
    max_steps_override?: number | null;
    time_limit_seconds?: number | null;
    allow_waiting?: boolean;
    interactive_canvas_id?: string | null;
    interactive_canvas_intent?: ProjectCanvasIntent | null;
    schedule?: {
      mode: "scheduled" | "infinite";
      state: "active" | "paused" | "cancelled";
      repeat: string | null;
      timezone: string | null;
      next_run_at: string | null;
      pending_run: boolean;
      run_timeout_seconds?: number | null;
      run_deadline_at?: string | null;
    } | null;
  };
  messages: TaskMessage[];
  debug_mode?: boolean;
  thread_counts?: TaskMessageThreadCount[];
  active_leaf_message_id?: string | null;
  // Only on a publicly shared task.
  run_count?: number;
  subtasks?: Array<{
    id: string;
    title: string | null;
    status: string;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  }>;
  latest_context_usage?: TaskContextUsage | null;
  workflow?: TaskWorkflowOverview | null;
}

export interface ProjectCanvasSummary {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  slug: string;
  rootPath: string;
  entryPath: string;
  lastTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCanvasListResponse {
  items: ProjectCanvasSummary[];
}

export interface ProjectCanvasResponse {
  canvas: ProjectCanvasSummary;
}

export interface ProjectCanvasPreviewTicketResponse {
  ticket: string;
  expiresAt: string;
}

export interface PersistentShellSessionSummary {
  id: string;
  status: "starting" | "running" | "idle" | "completed" | "stopped" | "failed";
  command: string;
  workingDir: string;
  startedAt: string | null;
  updatedAt: string;
  output: string | null;
  lifetimeSeconds?: number;
  expiresAt?: string | null;
}

export interface PersistentShellSessionListResponse {
  items: PersistentShellSessionSummary[];
}

export interface TaskContextUsage {
  usedTokens?: number;
  maxContextTokens?: number;
  utilization?: number;
  source?: string;
  stage?: string;
  step?: number;
  cachedTokens?: number;
  cacheHitRatio?: number;
  prefixHash?: string;
  promptRevision?: string;
  createdAt?: string;
}

export interface TaskMessageThreadCount {
  parent_message_id: string;
  count: number;
}

export interface TaskThreadSummary {
  task_id: string;
  parent_message_id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  selected_text: string | null;
  selected_text_location: string | null;
  latest_assistant_preview: string | null;
}

export interface LongHorizonWorkflowOverview {
  type: "long_horizon";
  phase: string;
  config: Record<string, unknown>;
  longHorizon: {
    plan: {
      content: string | null;
      createdAt: string | null;
    };
    latestRound: number;
    latestSubmissionMessage: string | null;
    reviews: Array<{
      id: string;
      round_no: number | null;
      reviewer_task_id: string | null;
      reviewer_slot_index: number | null;
      approved: boolean;
      review: string;
      created_at: string;
    }>;
    reviewers: Array<{
      workflow_agent_id: string;
      task_id: string;
      slot_index: number;
      title: string | null;
      status: string;
      updated_at: string;
    }>;
  };
}

export type TaskWorkflowOverview = LongHorizonWorkflowOverview | {
  type: "agent_swarm";
  phase: string;
  config: Record<string, unknown>;
};

export interface TaskArtifact {
  id: string;
  kind: string;
  relative_path: string;
  size_bytes: number | null;
  publication_state?: "pending" | "available" | "missing";
  mime_type: string | null;
  created_at: string;
}

export interface TaskArtifactsResponse {
  items: TaskArtifact[];
  canvases: ProjectCanvasSummary[];
}

export interface LiveEvent {
  id: string;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
  raw?: string;
}

export interface TaskEventsPageResponse {
  direction: "older" | "newer";
  hasMore: boolean;
  items: LiveEvent[];
}

export interface TaskMessageContentBatchResponse {
  items: TaskMessage[];
}

export interface TaskConversationBranchOptionItem {
  message_id: string;
  leaf_message_id: string | null;
  index: number;
}

export interface TaskConversationBranchOption {
  current_index: number;
  sibling_count: number;
  items: TaskConversationBranchOptionItem[];
}

export interface TaskConversationPageInfo {
  start_index: number;
  end_index: number;
  total_items: number;
  has_older: boolean;
  has_newer: boolean;
}

export interface TaskConversationPageResponse {
  active_leaf_message_id: string | null;
  messages: TaskMessage[];
  message_page: TaskConversationPageInfo;
  branch_options: Record<string, TaskConversationBranchOption>;
  // Full content of the tool messages that end the newest page.
  tool_message_contents?: TaskMessage[];
}

export interface TaskConversationSearchResult {
  messageId: string;
  messageIndex: number;
  matchIndex: number;
  role: string;
  createdAt: string;
  snippetBefore: string;
  matchText: string;
  snippetAfter: string;
}

export type TaskConversationSearchMatch = Pick<
  TaskConversationSearchResult,
  "messageId" | "matchIndex" | "matchText"
>;

export interface TaskConversationSearchResponse {
  items: TaskConversationSearchResult[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface LiveToolCall {
  id: string;
  callId: string | null;
  toolName: string;
  step: number | null;
  command: string | null;
  inputLabel: string;
  inputText: string;
  summary: string | null;
  interruptible: boolean;
  startedAt: string;
}

export interface WorkspaceNotification {
  id: string;
  task_id: string;
  task_title: string | null;
  task_status: string;
  project_id?: string;
  environment_id: string;
  project_name?: string;
  environment_name: string;
  task_type: TaskType;
  channel: string;
  status: string;
  run_id: string | null;
  preview: string | null;
  detail: string | null;
  external_message_id: string | null;
  created_at: string;
}

export interface BrowserNotificationSettings {
  enablePushNotifications: boolean;
  notifyOnBackgroundResponses: boolean;
}

export interface ShellSessionInfo {
  id: string;
  created_at: string;
  last_active_at: string;
  status: "running" | "closed";
}

export interface TaskAttachment {
  id: string;
  kind: "note" | "file" | "directory" | "canvas";
  label: string;
  content: string;
  relativePath?: string;
  sizeBytes?: number | null;
  forceInclude?: boolean;
}

export interface TaskToolOptions {
  webSearch: boolean;
  memorySearch: boolean;
  scheduleTask: boolean;
  subtasks: boolean;
  computerUse: boolean;
  interactiveCanvas?: boolean;
  enabledSkills: string[];
  enabledSources: string[];
}

export type TaskScheduleType = "standard" | "scheduled" | "infinite" | "timed";

export interface TaskWorkflowComposerConfig {
  type: TaskWorkflowComposerType;
  tokenBudget: number | null;
  timeBudgetMinutes?: number | null;
  enableClarifyPhase?: boolean;
  enableReviewPhase?: boolean;
  // Agent Swarm settings, prefilled from the selected swarm preset.
  routerId?: string | null;
  spawnEffort?: number;
  budgetsEnabled?: boolean;
  advanced?: AgentSwarmAdvancedSettings;
}

export interface TaskParameters {
  schedule: {
    type: TaskScheduleType;
    repeat: string | null;
    timezone: string | null;
    timeLimitSeconds: number | null;
    deadlineAt?: string | null;
  };
  maxSteps: number | null;
  timeLimitSeconds: number | null;
  allowWaiting: boolean;
}

export interface TaskAgentSelection {
  id: string;
}

export interface EnvironmentFileEntry {
  name: string;
  relativePath: string;
  kind: "directory" | "file" | "symlink" | "other";
  sizeBytes: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
  note?: string | null;
  liveSync?: EnvironmentFileLiveSyncSummary | null;
}

export type ProjectFileEntry = EnvironmentFileEntry;

export interface EnvironmentFileLiveSyncSummary {
  id: string;
  provider: "google-drive" | "onedrive" | "pcloud" | "rclone";
  sourceId: string;
  linkKind: "file" | "folder";
  remoteName: string;
  remoteWebUrl: string | null;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  lastSyncError: string | null;
}

export type ProjectFileLiveSyncSummary = EnvironmentFileLiveSyncSummary;

export interface StorageSummary {
  usedBytes: number;
  limitBytes: number | null;
  availableBytes: number | null;
  usagePercent: number | null;
  isOverLimit: boolean;
}

export interface EnvironmentFileListResponse {
  cwd: string;
  parentPath: string | null;
  items: EnvironmentFileEntry[];
  storage?: StorageSummary;
}

export type ProjectFileListResponse = EnvironmentFileListResponse;

// Storage is null when the server can't measure usage cheaply (anything but XFS quotas).
export interface StorageSummaryResponse {
  storage: StorageSummary | null;
}

export interface FileDeleteResponse {
  deletedCount: number;
  deletedPaths: string[];
  storage: StorageSummary | null;
}

export interface EnvironmentCleanupSuggestion {
  relativePath: string;
  taskId: string | null;
  taskTitle: string | null;
  taskStatus: string | null;
  sizeBytes: number;
  modifiedAt: string | null;
  ageDays: number;
  heuristicScore: number;
}

export type ProjectCleanupSuggestion = EnvironmentCleanupSuggestion;

export interface EnvironmentCleanupPlanResponse {
  targetPercent: number;
  targetBytes: number;
  reclaimableBytes: number;
  suggestedBytes: number;
  suggestions: EnvironmentCleanupSuggestion[];
  storage: StorageSummary | null;
}

export type ProjectCleanupPlanResponse = EnvironmentCleanupPlanResponse;

export interface WorkspaceSettings {
  modelDefaults: Record<string, unknown>;
  modelRequestTimeoutMs: number | null;
  effectiveModelRequestTimeoutMs: number;
  shellToolMaxTimeoutMs: number | null;
  effectiveShellToolMaxTimeoutMs: number;
  mcpTimeoutMs: number | null;
  effectiveMcpTimeoutMs: number;
  contextCompactionBackend: "summary" | "native";
  newMessageOrganizationEnabled: boolean;
  projectMasterEnabled?: boolean;
  defaultAgentId?: string | null;
  nativeCompactionEnabled: boolean;
  sendMetadataToModel: boolean;
  claudeCacheKeepalive?: boolean;
  codeModeEnabled?: boolean;
  systemPrompt: string;
  personalityId: string | null;
  effectivePersonalityId: string | null;
  sandboxNetworkEnabled: boolean | null;
  effectiveSandboxNetworkEnabled: boolean;
  defaultToolset: TaskToolOptions;
  memoryEnabled: boolean;
  thoughtPersistenceEnabled: boolean;
  memorySynthesisEnabled: boolean;
  suggestedActionsEnabled: boolean;
  runAsRoot: boolean;
}

export type { ProjectSuggestedAction } from "@meowbert/shared/memory";

export interface EnvironmentFilePreview {
  relativePath: string;
  sizeBytes: number;
  truncated: boolean;
  encoding: "binary" | "utf-8";
  text: string | null;
}

export type ProjectFilePreview = EnvironmentFilePreview;

export interface EnvironmentFileLiveSyncStatus {
  link: {
    id: string;
    workspaceId: string;
    environmentId: string;
    taskId: string | null;
    provider: "google-drive" | "onedrive" | "pcloud" | "rclone";
    sourceId: string;
    linkKind: "file" | "folder";
    remoteItemId: string;
    remoteName: string;
    remoteMimeType: string | null;
    remoteWebUrl: string | null;
    localRelativePath: string;
    syncMode: "manual";
    lastSyncedRemoteEtag: string | null;
    lastSyncedRemoteCtag: string | null;
    lastSyncedRemoteModifiedAt: string | null;
    lastSyncedRemoteSizeBytes: number | null;
    lastSyncedLocalHash: string | null;
    lastSyncedLocalSizeBytes: number | null;
    lastSyncedLocalModifiedAt: string | null;
    lastPulledAt: string | null;
    lastPushedAt: string | null;
    lastSyncError: string | null;
    createdByUserId: string | null;
    updatedByUserId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  status: "synced" | "local_modified" | "remote_modified" | "conflict" | "missing_local" | "missing_remote" | "error";
  local: {
    exists: boolean;
    relativePath: string;
    kind: "file" | "folder" | null;
    sizeBytes: number | null;
    modifiedAt: string | null;
    hash: string | null;
  };
  remote: {
    itemId: string;
    kind: "file" | "folder";
    name: string;
    mimeType: string | null;
    webUrl: string | null;
    modifiedAt: string | null;
    sizeBytes: number | null;
    eTag: string | null;
    cTag: string | null;
  } | null;
  localChanged: boolean;
  remoteChanged: boolean;
  canPull: boolean;
  canPush: boolean;
  supportsForcePull: boolean;
  supportsForcePush: boolean;
  message: string | null;
}

export type ProjectFileLiveSyncStatus = EnvironmentFileLiveSyncStatus;

export interface WorkspaceContextValue {
  api: ApiClient;
  token: string;
  user: UserProfile | null;
  workspaces: Workspace[];
  projects?: Project[];
  environments: Environment[];
  tasks: TaskSummary[];
  workspaceSettings: WorkspaceSettings | null;
  isWorkspaceSettingsLoading: boolean;
  activeWorkspaceId: string;
  activeProjectId?: string | null;
  activeEnvironmentId: string | null;
  isBootstrapping: boolean;
  isEnvironmentsLoading: boolean;
  isTasksLoading: boolean;
  setFlash: (flash: FlashMessage | null) => void;
  refreshWorkspaces: () => Promise<void>;
  refreshProjects?: () => Promise<void>;
  refreshEnvironments: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshWorkspaceSettings: () => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  createProject?: (name: string) => Promise<void>;
  createEnvironment: (name: string) => Promise<void>;
  patchProject?: (environmentId: string, input: {
    name?: string;
    status?: "active" | "archived" | "error";
    jsonPayload?: Record<string, unknown>;
  }) => Promise<void>;
  patchEnvironment: (environmentId: string, input: {
    name?: string;
    status?: "active" | "archived" | "error";
    jsonPayload?: Record<string, unknown>;
  }) => Promise<void>;
  replaceSessionToken: (token: string) => void;
}

export interface AdminSettings {
  allowUserSignup: boolean;
  requireAdminSignupApproval: boolean;
  enableForgotPassword: boolean;
  requireEmailVerificationOnSignup: boolean;
  enablePromptCaching: boolean;
  debugMode: boolean;
  defaultFreeMessageLimit: number | null;
  maxTaskRunRetries: number;
  taskScheduler: {
    defaultEnvironmentConcurrency: number;
    maxWorkspaceConcurrency: number;
    maxQueuedAheadPerWorkspace: number;
    backgroundAgingMinutes: number;
  };
  usageRateMultiplier: number;
  modelMetadata: Record<string, Record<string, unknown>>;
  modelRouters: Array<{
    id: string;
    routingModel: string;
    defaultTargetModel: string;
    allowQuickMode?: boolean;
    allowReasoningEffort?: boolean;
    models: Array<{
      id: string;
      description: string;
      model: string;
      payload: Record<string, unknown>;
    }>;
  }>;
  agentPresets: Array<{
    id: string;
    name: string;
    description: string;
    requiresSuperAdmin: boolean;
    hidden?: boolean;
    payload: Record<string, unknown>;
    mode?: "standard" | "agent_swarm" | "quality_control_reviewer";
    leaderAgentId?: string;
    routerId?: string | null;
    budgetsEnabled?: boolean;
    tokenBudget?: number;
    timeBudgetMinutes?: number;
    advanced?: AgentSwarmAdvancedSettings;
  }>;
  specializedModels: {
    internalModel: string | null;
    fastModel: string | null;
    memorySynthesisAgent: string | null;
    reviewerAgent: string | null;
  subagentFastAgent: string | null;
  };
  modelSliderAgentIds: string[];
}
