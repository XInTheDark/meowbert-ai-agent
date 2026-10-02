import type { TokenUsageTotals } from "@meowbert/shared/token-usage-stats";
import type { AdminSettings } from "../../../lib/types";
import type { AdminSourceProviderSettings } from "../../../sources/sourceTypes";

export interface AdminSettingsResponse {
  settings: AdminSettings;
}

export interface AdminStorageBackendSummary {
  id: string;
  type: "local" | "mounted";
  label: string;
  workspaceCount: number;
  mounted: boolean;
  healthState: "ready" | "error";
  healthMessage: string | null;
}

export interface AdminWorkspaceStorageMigrationSummary {
  id: string;
  sourceBackendId: string;
  targetBackendId: string;
  status: "queued" | "running" | "failed" | "completed" | "cancelled";
  errorSummary: string | null;
  requestSource: "manual" | "default_change_bulk";
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AdminWorkspaceStorageSummary {
  id: string;
  name: string;
  ownerEmail: string | null;
  storageBackendId: string;
  storageBackendLabel: string;
  rootPath: string;
  latestMigration: AdminWorkspaceStorageMigrationSummary | null;
}

export interface AdminStorageUserSummary {
  id: string;
  email: string;
  displayName: string | null;
  ownedWorkspaceCount: number;
}

export interface AdminActiveWorkspaceStorageMigrationSummary {
  id: string;
  workspaceId: string;
  workspaceName: string;
  ownerEmail: string | null;
  sourceBackendId: string;
  sourceBackendLabel: string;
  targetBackendId: string;
  targetBackendLabel: string;
  status: "queued" | "running";
  requestSource: "manual" | "default_change_bulk";
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
}

export interface AdminStorageMigrationActivitySummary {
  queuedCount: number;
  runningCount: number;
  hiddenActiveCount: number;
  activeMigrations: AdminActiveWorkspaceStorageMigrationSummary[];
}

export interface AdminTaskHistoryArchiveSummary {
  enabled: boolean;
  mountPath: string | null;
  rootPath: string | null;
  mounted: boolean;
  healthState: "ready" | "error" | "disabled";
  healthMessage: string | null;
  warmRetentionDays: number;
  taskCount: number;
}

export interface AdminStorageOverview {
  defaultWorkspaceBackendId: string;
  configuredDefaultWorkspaceBackendId: string;
  backends: AdminStorageBackendSummary[];
  migrationActivity: AdminStorageMigrationActivitySummary;
  taskHistoryArchive: AdminTaskHistoryArchiveSummary;
  workspaces: AdminWorkspaceStorageSummary[];
}

export interface AdminStorageResponse {
  storage: AdminStorageOverview;
}

export interface AdminPostgresRelationStorage {
  name: string;
  tableBytes: number;
  indexBytes: number;
  totalBytes: number;
  estimatedLiveRows: number;
  estimatedDeadRows: number;
  lastVacuumAt: string | null;
  lastAutovacuumAt: string | null;
}

export interface AdminTaskHistoryArchiveRun {
  id: string;
  taskId: string | null;
  taskTitle: string | null;
  triggerSource: "scheduled" | "manual";
  status: "queued" | "running" | "completed" | "skipped" | "failed";
  archiveKey: string | null;
  originalSizeBytes: number | null;
  compressedSizeBytes: number | null;
  messageCount: number | null;
  eventCount: number | null;
  revisionCount: number | null;
  workflowMessageCount: number | null;
  errorSummary: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AdminHostStorageOverview {
  postgres: {
    databaseName: string;
    databaseBytes: number;
    relations: AdminPostgresRelationStorage[];
  };
  eventRetention: {
    debugMode: boolean;
    pruningEnabled: boolean;
    retainedEventsPerTask: number;
    insertPruneBatchSize: number;
    backlogIntervalSeconds: number;
    backlogDeleteBatchSize: number;
    safetyIntervalHours: number;
  };
  taskHistoryArchive: {
    enabled: boolean;
    mountPath: string | null;
    rootPath: string | null;
    mounted: boolean;
    healthState: "ready" | "error" | "disabled";
    healthMessage: string | null;
    warmRetentionDays: number;
    warmTaskCount: number;
    archivingTaskCount: number;
    archivedTaskCount: number;
    failedTaskCount: number;
    eligibleTaskCount: number;
    recentRuns: AdminTaskHistoryArchiveRun[];
  };
}

export interface AdminHostStorageResponse {
  hostStorage: AdminHostStorageOverview;
}

export interface AdminTaskEventPruneResponse {
  debugMode: boolean;
  deletedCount: number;
}

export interface AdminTaskEventsVacuumFullResponse {
  result: {
    startedAt: string;
    completedAt: string;
    beforeBytes: number;
    afterBytes: number;
    reclaimedBytes: number;
  };
}

export interface AdminTaskHistoryArchiveRunResponse {
  run: AdminTaskHistoryArchiveRun;
}

export interface AdminTaskProcessSummary {
  taskId: string;
  taskTitle: string | null;
  taskStatus: "queued" | "starting" | "running";
  taskSource: string;
  workflowType: string | null;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  initiatorUserId: string | null;
  initiatorEmail: string | null;
  initiatorDisplayName: string | null;
  runId: string | null;
  runAttemptNo: number | null;
  runKind: string | null;
  runStartedAt: string | null;
  workerId: string | null;
  dispatchQueueState: string | null;
  dispatchClass: string | null;
  dispatchQueuedAt: string | null;
  dispatchStartedAt: string | null;
}

export interface AdminProcessOverview {
  totalCount: number;
  queuedCount: number;
  startingCount: number;
  runningCount: number;
  processes: AdminTaskProcessSummary[];
}

export interface AdminProcessesResponse {
  processes: AdminProcessOverview;
}

export type AdminStatisticsBucket = "hour" | "day" | "week" | "month";
export type AdminStatisticsRange = "24h" | "7d" | "30d" | "90d" | "custom";

export interface AdminUsageStatisticsSummary extends TokenUsageTotals {
  activeUserCount: number;
  modelCount: number;
  averageTokensPerRequest: number;
}

export interface AdminUsageStatisticsPoint extends TokenUsageTotals {
  bucketStart: string;
}

export interface AdminUsageStatisticsBreakdown extends TokenUsageTotals {
  id: string;
  label: string;
  detail: string | null;
}

export interface AdminUsageStatisticsFilterOption {
  id: string;
  label: string;
  detail: string | null;
  requestCount: number;
  totalTokens: number;
}

export interface AdminUsageStatistics {
  range: {
    from: string;
    to: string;
    bucket: AdminStatisticsBucket;
  };
  summary: AdminUsageStatisticsSummary;
  timeSeries: AdminUsageStatisticsPoint[];
  modelBreakdown: AdminUsageStatisticsBreakdown[];
  userBreakdown: AdminUsageStatisticsBreakdown[];
  filterOptions: {
    models: AdminUsageStatisticsFilterOption[];
    users: AdminUsageStatisticsFilterOption[];
  };
}

export interface AdminUsageStatisticsResponse {
  usage: AdminUsageStatistics;
}

export interface AdminTaskHistoryArchiveUpdateResponse {
  warmRetentionDays: number;
}

export interface AdminStorageBackendTestResponse {
  backend: AdminStorageBackendSummary;
}

export interface AdminStorageUserSearchResponse {
  users: AdminStorageUserSummary[];
}

export interface AdminRuntimeMigrationRunSummary {
  id: string;
  status: "queued" | "running" | "failed" | "completed" | "cancelled";
  errorSummary: string | null;
  summary: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AdminRuntimeMigrationSummary {
  key: "nest_environment_roots" | "provision_local_xfs_project_quotas";
  title: string;
  description: string;
  status: "ready" | "up_to_date" | "action_required" | "queued" | "running" | "failed";
  blockedReason: string | null;
  pendingItems: number;
  detail: string;
  latestRun: AdminRuntimeMigrationRunSummary | null;
}

export interface AdminRuntimeMigrationsResponse {
  migrations: AdminRuntimeMigrationSummary[];
}

export interface AdminRuntimeMigrationRunResponse {
  migration: AdminRuntimeMigrationRunSummary;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  monthlyTokenQuota: number;
  usageLimits: SubscriptionUsageLimit[];
  notes: string | null;
  isActive: boolean;
  isDefault?: boolean;
  workspaceLimit: number | null;
  sandboxPidsLimit: number | null;
  sandboxMemoryMb: number | null;
  sandboxCpus: number | null;
  workspaceStorageMb: number | null;
  persistentRuntimeComputeCredits: number | null;
  persistentRuntimeLimit: number | null;
  agentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionPlanInput {
  name: string;
  usageLimits: SubscriptionUsageLimit[];
  notes: string | null;
  workspaceLimit: number | null;
  sandboxPidsLimit: number | null;
  sandboxMemoryMb: number | null;
  sandboxCpus: number | null;
  workspaceStorageMb: number | null;
  persistentRuntimeComputeCredits: number | null;
  persistentRuntimeLimit: number | null;
  agentIds: string[];
}

export interface SubscriptionUsageLimit {
  weightedTokens: number;
  durationDays: number;
}

export interface SubscriptionPlansResponse {
  plans: SubscriptionPlan[];
}

export interface NewsletterCampaignSummary {
  id: string;
  subject: string;
  bodyText: string;
  status: "queued" | "sending" | "completed" | "failed";
  createdByUserId: string | null;
  createdAt: string;
  totalRecipients: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
}

export interface NewsletterCampaignsResponse {
  campaigns: NewsletterCampaignSummary[];
}

export interface SharedConnectorAdminState {
  connectorType: "telegram" | "discord";
  enabled: boolean;
  hasToken: boolean;
  botUserId: string | null;
  telegramIngestMode: "webhook" | "polling";
}

export interface ListmonkConnectorAdminState {
  provider: "listmonk";
  enabled: boolean;
  baseUrl: string | null;
  apiUsername: string | null;
  hasApiToken: boolean;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailInboundConnectorAdminState {
  provider: "brevo";
  enabled: boolean;
  inboundDomain: string | null;
  addressMode: "random" | "workspace_custom";
  hasWebhookSecret: boolean;
  hasBrevoApiKey: boolean;
  debugLoggingEnabled: boolean;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  webhookUrl?: string | null;
}

export interface EmailInboundDebugEvent {
  id: string;
  provider: "brevo";
  workspaceId: string | null;
  bindingId: string | null;
  eventType: string;
  level: "info" | "warn" | "error";
  message: string;
  details: unknown;
  createdAt: string;
}

export interface EmailInboundDebugEventsResponse {
  events: EmailInboundDebugEvent[];
}

export interface AdminSourcesResponse {
  sources: AdminSourceProviderSettings[];
}

export interface SharedConnectorStatusResponse {
  connectors: {
    telegram: SharedConnectorAdminState;
    discord: SharedConnectorAdminState;
    listmonk: ListmonkConnectorAdminState;
    emailInbound: EmailInboundConnectorAdminState;
  };
}

export interface UpdateListmonkConnectorResponse {
  connector: ListmonkConnectorAdminState;
  warning?: string;
}

export interface UpdateEmailInboundConnectorResponse {
  connector: EmailInboundConnectorAdminState;
}

export interface SyncBrevoInboundWebhookResponse {
  action: "created" | "updated" | "existing";
  webhook: {
    id: number;
    type: string;
    url: string;
    domain: string | null;
    events: string[];
    description: string | null;
  };
}

export interface AnnouncementSummary {
  id: string;
  title: string;
  body: string;
  notify: boolean;
  created_at: string;
}

export type AdminSettingsTabKey =
  | "settings"
  | "statistics"
  | "processes"
  | "utilities"
  | "storage"
  | "host-storage"
  | "migrations"
  | "model"
  | "ai-providers"
  | "connectors"
  | "sources"
  | "users"
  | "subscriptions"
  | "newsletter"
  | "announcements";

export function formatDebugDetails(details: unknown): string {
  try {
    return JSON.stringify(details ?? {}, null, 2);
  } catch {
    return String(details);
  }
}
