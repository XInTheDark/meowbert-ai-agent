export type TaskStatus =
  | "queued"
  | "starting"
  | "running"
  | "awaiting_input"
  | "succeeded"
  | "failed"
  | "cancelled";

export const CONNECTOR_TYPES = ["telegram", "discord", "github", "email"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export type TaskSource = "web" | ConnectorType;
export type TaskWorkflowType = "long_horizon" | "agent_swarm";

export type TaskEventType =
  | "status"
  | "log"
  | "command_start"
  | "command_end"
  | "model_routed"
  | "thinking_start"
  | "thinking_end"
  | "context_usage"
  | "compaction"
  | "notification"
  | "artifact"
  | "error";

export interface TaskExecutionJob {
  taskId: string;
  runId: string;
  workspaceId: string;
  environmentId: string;
  triggerSource: TaskSource;
  mode?:
    | "default"
    | "compact_only"
    | "scheduled_auto"
    | "infinite_auto"
    | "infinite_checkin"
    | "long_horizon_clarify"
    | "long_horizon_main"
    | "long_horizon_reviewer"
    | "quality_control_reviewer"
    | "agent_swarm_leader"
    | "agent_swarm_worker"
    | "memory_synthesis";
  restoreStatus?: TaskStatus;
  branchMessageId?: string;
  selectionUserId?: string;
  toolOptionsOverride?: TaskRunToolOptions;
  quickMode?: boolean;
  contextAction?: "compact" | "clear";
}

export interface TaskRunToolOptions {
  webSearch?: boolean;
  memorySearch?: boolean;
  scheduleTask?: boolean;
  subtasks?: boolean;
  computerUse?: boolean;
  interactiveCanvas?: boolean;
  enabledSkills?: string[];
  enabledSources?: string[];
}

export interface RoutingDecision {
  environmentId: string;
  reason: string;
  confidence: number;
  matchedRuleId?: string;
}

export interface TaskEventPayload {
  id: string;
  taskId: string;
  type: TaskEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SkillManifestMcpStdio {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface SkillManifestMcpSse {
  transport: "sse";
  url: string;
}

export type SkillManifestMcp = SkillManifestMcpStdio | SkillManifestMcpSse;

export type SkillManifestSurface = "skill" | "source" | "internal";
export type SkillCatalogGroup = "core" | "visuals" | "documents" | "web" | "custom" | "skill";

export interface SkillManifestSourceMetadata {
  provider: string;
  supportsAttachments?: boolean;
  attachmentMode?: "file" | "note";
  requiresAdminCredentials?: boolean;
  requiresWorkspaceConnection?: boolean;
}

export interface SkillManifestSourceAccess {
  sourceId: string;
}

export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  requiresSuperAdmin?: boolean;
  hidden?: boolean;
  surface?: SkillManifestSurface;
  catalogGroup?: SkillCatalogGroup;
  source?: SkillManifestSourceMetadata;
  sourceAccess?: SkillManifestSourceAccess;
  mcp: SkillManifestMcp;
}

export const TASK_QUEUE_NAME = "task-execution";
export const EMAIL_DELIVERY_QUEUE_NAME = "email-delivery";
export const TASK_EVENT_CHANNEL_PREFIX = "task-events:";
export const WORKSPACE_NOTIFICATION_CHANNEL_PREFIX = "workspace-notifications:";

export function buildTaskRunQueueJobId(taskId: string, runId: string): string {
  return `task-${taskId}-run-${runId}`;
}

export interface EmailDeliveryJob {
  outboxEmailId: string;
}

export function buildEmailDeliveryQueueJobId(outboxEmailId: string): string {
  return `email-${outboxEmailId}`;
}

export interface WebPushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  notifyOnBackgroundResponses: boolean;
  userAgent?: string;
}

export interface WebPushNotificationPayload {
  title: string;
  body: string;
  tag: string;
  route: string;
  taskId?: string;
  runId?: string;
}
