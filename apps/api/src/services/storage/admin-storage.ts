import { query, withTransaction } from "../../lib/db.js";
import { storageBackendRegistry } from "./backend-registry.js";
import { getDefaultWorkspaceStorageBackendId, updateDefaultWorkspaceStorageBackendId } from "./default-backend.js";
import { getConfiguredTaskHistoryArchiveHealth } from "../tasks/task-history.js";

export type WorkspaceStorageMigrationRequestSource = "manual" | "default_change_bulk";
export const TASK_HISTORY_WARM_RETENTION_DAYS_MAX = 3650;

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
  requestSource: WorkspaceStorageMigrationRequestSource;
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
  requestSource: WorkspaceStorageMigrationRequestSource;
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

interface WorkspaceRow {
  id: string;
  name: string;
  root_path: string;
  storage_backend_id: string;
  owner_email: string | null;
  latest_migration_id: string | null;
  latest_migration_source_backend_id: string | null;
  latest_migration_target_backend_id: string | null;
  latest_migration_status: "queued" | "running" | "failed" | "completed" | "cancelled" | null;
  latest_migration_error_summary: string | null;
  latest_migration_request_source: WorkspaceStorageMigrationRequestSource | null;
  latest_migration_created_at: string | null;
  latest_migration_updated_at: string | null;
  latest_migration_started_at: string | null;
  latest_migration_completed_at: string | null;
}

interface ActiveWorkspaceMigrationCountsRow {
  queued_count: number;
  running_count: number;
}

interface ActiveWorkspaceMigrationRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  owner_email: string | null;
  source_backend_id: string;
  target_backend_id: string;
  status: "queued" | "running";
  request_source: WorkspaceStorageMigrationRequestSource;
  created_at: string;
  updated_at: string;
  started_at: string | null;
}

interface TaskHistoryArchiveSummaryRow {
  task_history_warm_retention_days: number;
  task_count: number;
}

const ACTIVE_WORKSPACE_STORAGE_MIGRATION_LIMIT = 12;

function mapAdminStorageBackendSummary(input: {
  backend: ReturnType<typeof storageBackendRegistry.getBackend>;
  workspaceCount: number;
  health: Awaited<ReturnType<typeof storageBackendRegistry.getBackendHealth>>;
}): AdminStorageBackendSummary {
  return {
    id: input.backend.id,
    type: input.backend.type,
    label: getBackendLabel(input.backend.id),
    workspaceCount: input.workspaceCount,
    mounted: input.health.mounted,
    healthState: input.health.state,
    healthMessage: input.health.message
  };
}

function getBackendLabel(backendId: string): string {
  try {
    const backend = storageBackendRegistry.getBackend(backendId);
    if (typeof backend.label === "string" && backend.label.trim().length > 0) {
      return backend.label.trim();
    }

    if (backend.type === "local") {
      return backendId === storageBackendRegistry.getConfiguredDefaultBackendId() ? "Local (legacy)" : `Local (${backendId})`;
    }

    return `Mounted path (${backendId})`;
  } catch {
    return `${backendId} (missing config)`;
  }
}

async function countWorkspacesByBackendId(backendId: string): Promise<number> {
  const countRes = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM workspaces
      WHERE storage_backend_id = $1`,
    [backendId]
  );

  return Number(countRes.rows[0]?.count ?? 0);
}

async function listAdminStorageWorkspaceRows(ownerUserId?: string | null): Promise<WorkspaceRow[]> {
  if (!ownerUserId) {
    return [];
  }

  const workspacesRes = await query<WorkspaceRow>(
    `SELECT w.id,
            w.name,
            w.root_path,
            w.storage_backend_id,
            owner.owner_email,
            latest.id AS latest_migration_id,
            latest.source_backend_id AS latest_migration_source_backend_id,
            latest.target_backend_id AS latest_migration_target_backend_id,
            latest.status AS latest_migration_status,
            latest.error_summary AS latest_migration_error_summary,
            latest.request_source AS latest_migration_request_source,
            latest.created_at::text AS latest_migration_created_at,
            latest.updated_at::text AS latest_migration_updated_at,
            latest.started_at::text AS latest_migration_started_at,
            latest.completed_at::text AS latest_migration_completed_at
       FROM workspaces w
       JOIN workspace_members owner_filter
         ON owner_filter.workspace_id = w.id
        AND owner_filter.user_id = $1
        AND owner_filter.role = 'owner'
       LEFT JOIN LATERAL (
         SELECT u.email AS owner_email
           FROM workspace_members wm
           JOIN users u ON u.id = wm.user_id
          WHERE wm.workspace_id = w.id
            AND wm.role = 'owner'
          ORDER BY wm.created_at ASC
          LIMIT 1
       ) owner ON TRUE
       LEFT JOIN LATERAL (
         SELECT m.id,
                m.source_backend_id,
                m.target_backend_id,
                m.status,
                m.error_summary,
                m.request_source,
                m.created_at,
                m.updated_at,
                m.started_at,
                m.completed_at
           FROM workspace_storage_migrations m
          WHERE m.workspace_id = w.id
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 1
       ) latest ON TRUE
      ORDER BY w.created_at ASC, w.id ASC`,
    [ownerUserId]
  );

  return workspacesRes.rows;
}

function mapAdminWorkspaceStorageSummary(workspace: WorkspaceRow): AdminWorkspaceStorageSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    ownerEmail: workspace.owner_email,
    storageBackendId: workspace.storage_backend_id,
    storageBackendLabel: getBackendLabel(workspace.storage_backend_id),
    rootPath: workspace.root_path,
    latestMigration: workspace.latest_migration_id
      ? {
          id: workspace.latest_migration_id,
          sourceBackendId: workspace.latest_migration_source_backend_id ?? workspace.storage_backend_id,
          targetBackendId: workspace.latest_migration_target_backend_id ?? workspace.storage_backend_id,
          status: workspace.latest_migration_status ?? "failed",
          errorSummary: workspace.latest_migration_error_summary,
          requestSource: workspace.latest_migration_request_source ?? "manual",
          createdAt: workspace.latest_migration_created_at ?? new Date(0).toISOString(),
          updatedAt: workspace.latest_migration_updated_at ?? new Date(0).toISOString(),
          startedAt: workspace.latest_migration_started_at,
          completedAt: workspace.latest_migration_completed_at
        }
      : null
  };
}

function mapActiveWorkspaceMigrationRow(
  row: ActiveWorkspaceMigrationRow
): AdminActiveWorkspaceStorageMigrationSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    ownerEmail: row.owner_email,
    sourceBackendId: row.source_backend_id,
    sourceBackendLabel: getBackendLabel(row.source_backend_id),
    targetBackendId: row.target_backend_id,
    targetBackendLabel: getBackendLabel(row.target_backend_id),
    status: row.status,
    requestSource: row.request_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at
  };
}

async function listAdminStorageMigrationActivity(): Promise<AdminStorageMigrationActivitySummary> {
  const countsRes = await query<ActiveWorkspaceMigrationCountsRow>(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
        COUNT(*) FILTER (WHERE status = 'running')::int AS running_count
       FROM workspace_storage_migrations
      WHERE status IN ('queued', 'running')`
  );

  const queuedCount = Number(countsRes.rows[0]?.queued_count ?? 0);
  const runningCount = Number(countsRes.rows[0]?.running_count ?? 0);
  const activeCount = queuedCount + runningCount;
  if (activeCount === 0) {
    return {
      queuedCount,
      runningCount,
      hiddenActiveCount: 0,
      activeMigrations: []
    };
  }

  const activeRowsRes = await query<ActiveWorkspaceMigrationRow>(
    `SELECT m.id,
            w.id AS workspace_id,
            w.name AS workspace_name,
            owner.owner_email,
            m.source_backend_id,
            m.target_backend_id,
            m.status,
            m.request_source,
            m.created_at::text AS created_at,
            m.updated_at::text AS updated_at,
            m.started_at::text AS started_at
       FROM workspace_storage_migrations m
       JOIN workspaces w
         ON w.id = m.workspace_id
       LEFT JOIN LATERAL (
         SELECT u.email AS owner_email
           FROM workspace_members wm
           JOIN users u
             ON u.id = wm.user_id
          WHERE wm.workspace_id = w.id
            AND wm.role = 'owner'
          ORDER BY wm.created_at ASC
          LIMIT 1
       ) owner ON TRUE
      WHERE m.status IN ('queued', 'running')
      ORDER BY CASE WHEN m.status = 'running' THEN 0 ELSE 1 END ASC,
               COALESCE(m.started_at, m.created_at) ASC,
               m.id ASC
      LIMIT $1`,
    [ACTIVE_WORKSPACE_STORAGE_MIGRATION_LIMIT]
  );

  return {
    queuedCount,
    runningCount,
    hiddenActiveCount: Math.max(0, activeCount - activeRowsRes.rows.length),
    activeMigrations: activeRowsRes.rows.map(mapActiveWorkspaceMigrationRow)
  };
}

async function getAdminTaskHistoryArchiveSummary(): Promise<AdminTaskHistoryArchiveSummary> {
  const [health, summaryRes] = await Promise.all([
    getConfiguredTaskHistoryArchiveHealth(),
    query<TaskHistoryArchiveSummaryRow>(
      `SELECT COALESCE(
          (SELECT task_history_warm_retention_days
             FROM platform_settings
            WHERE id = 1),
          0
        )::int AS task_history_warm_retention_days,
        (
          SELECT COUNT(*)::int
            FROM tasks
        ) AS task_count`
    )
  ]);

  const summary = summaryRes.rows[0];
  return {
    enabled: health.enabled,
    mountPath: health.mountPath,
    rootPath: health.rootPath,
    mounted: health.mounted,
    healthState: health.state,
    healthMessage: health.message,
    warmRetentionDays: Number(summary?.task_history_warm_retention_days ?? 0) || 0,
    taskCount: Number(summary?.task_count ?? 0) || 0
  };
}

export async function listAdminStorageOverview(input: {
  ownerUserId?: string | null;
} = {}): Promise<AdminStorageOverview> {
  const [defaultWorkspaceBackendId, workspaceCountsRes, migrationActivity, taskHistoryArchive, workspaceRows, backendHealth] = await Promise.all([
    getDefaultWorkspaceStorageBackendId(),
    query<{ storage_backend_id: string; count: number }>(
      `SELECT storage_backend_id, COUNT(*)::int AS count
         FROM workspaces
        GROUP BY storage_backend_id`
    ),
    listAdminStorageMigrationActivity(),
    getAdminTaskHistoryArchiveSummary(),
    listAdminStorageWorkspaceRows(input.ownerUserId),
    Promise.all(
      storageBackendRegistry.listBackends().map(async (backend) => ({
        backend,
        health: await storageBackendRegistry.getBackendHealth(backend.id, {
          ensureMounted: false
        })
      }))
    )
  ]);

  const workspaceCountByBackendId = new Map(
    workspaceCountsRes.rows.map((row) => [row.storage_backend_id, Number(row.count)])
  );

  return {
    defaultWorkspaceBackendId,
    configuredDefaultWorkspaceBackendId: storageBackendRegistry.getConfiguredDefaultBackendId(),
    backends: backendHealth.map(({ backend, health }) =>
      mapAdminStorageBackendSummary({
        backend,
        health,
        workspaceCount: workspaceCountByBackendId.get(backend.id) ?? 0
      })
    ),
    migrationActivity,
    taskHistoryArchive,
    workspaces: workspaceRows.map(mapAdminWorkspaceStorageSummary)
  };
}

export async function testAdminStorageBackend(input: { backendId: string }): Promise<AdminStorageBackendSummary> {
  const backend = storageBackendRegistry.getBackend(input.backendId);
  const [workspaceCount, health] = await Promise.all([
    countWorkspacesByBackendId(input.backendId),
    storageBackendRegistry.getBackendHealth(input.backendId, { ensureMounted: true })
  ]);

  return mapAdminStorageBackendSummary({
    backend,
    workspaceCount,
    health
  });
}

export async function searchAdminStorageUsers(input: {
  search: string;
  limit?: number;
}): Promise<AdminStorageUserSummary[]> {
  const search = input.search.trim().toLowerCase();
  if (!search) {
    return [];
  }

  const limit = Math.max(1, Math.min(20, Math.floor(input.limit ?? 10)));
  const usersRes = await query<{
    id: string;
    email: string;
    display_name: string | null;
    owned_workspace_count: number;
  }>(
    `SELECT u.id,
            u.email,
            u.display_name,
            COUNT(wm.workspace_id)::int AS owned_workspace_count
       FROM users u
       LEFT JOIN workspace_members wm
         ON wm.user_id = u.id
        AND wm.role = 'owner'
      WHERE u.email ILIKE $1
      GROUP BY u.id, u.email, u.display_name, u.created_at
      ORDER BY CASE
                 WHEN LOWER(u.email) = $2 THEN 0
                 WHEN LOWER(u.email) LIKE $3 THEN 1
                 ELSE 2
               END ASC,
               COUNT(wm.workspace_id) DESC,
               u.created_at DESC
      LIMIT $4`,
    [`%${search}%`, search, `${search}%`, limit]
  );

  return usersRes.rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    ownedWorkspaceCount: Number(row.owned_workspace_count)
  }));
}

export async function updateAdminStorageDefaultBackend(input: { backendId: string }): Promise<string> {
  storageBackendRegistry.getBackend(input.backendId);
  return updateDefaultWorkspaceStorageBackendId(input.backendId);
}

export async function updateAdminTaskHistoryWarmRetentionDays(input: {
  warmRetentionDays: number;
}): Promise<number> {
  const warmRetentionDays = Math.floor(input.warmRetentionDays);
  if (!Number.isInteger(warmRetentionDays) || warmRetentionDays < 0 || warmRetentionDays > TASK_HISTORY_WARM_RETENTION_DAYS_MAX) {
    throw new Error(`Warm retention days must be between 0 and ${TASK_HISTORY_WARM_RETENTION_DAYS_MAX}.`);
  }

  await query(
    `INSERT INTO platform_settings (id, task_history_warm_retention_days)
     VALUES (1, $1)
     ON CONFLICT (id)
     DO UPDATE SET task_history_warm_retention_days = EXCLUDED.task_history_warm_retention_days,
                   updated_at = now()`,
    [warmRetentionDays]
  );

  return warmRetentionDays;
}

export async function queueWorkspaceStorageMigration(input: {
  workspaceId: string;
  targetBackendId: string;
  requestedByUserId: string;
  requestSource?: WorkspaceStorageMigrationRequestSource;
}): Promise<{ id: string; status: string }> {
  storageBackendRegistry.getBackend(input.targetBackendId);

  return withTransaction(async (client) => {
    const workspaceRes = await client.query<{ storage_backend_id: string }>(
      `SELECT storage_backend_id
         FROM workspaces
        WHERE id = $1
        FOR UPDATE`,
      [input.workspaceId]
    );

    if ((workspaceRes.rowCount ?? 0) === 0) {
      throw new Error("Workspace not found");
    }

    const sourceBackendId = workspaceRes.rows[0]?.storage_backend_id?.trim()
      || storageBackendRegistry.getConfiguredDefaultBackendId();
    if (sourceBackendId === input.targetBackendId) {
      throw new Error("Workspace is already using that storage backend");
    }

    const activeMigrationRes = await client.query<{ id: string }>(
      `SELECT id
         FROM workspace_storage_migrations
        WHERE workspace_id = $1
          AND status IN ('queued', 'running')
        LIMIT 1`,
      [input.workspaceId]
    );
    if ((activeMigrationRes.rowCount ?? 0) > 0) {
      throw new Error("Workspace already has a pending storage migration");
    }

    const insertedRes = await client.query<{ id: string; status: string }>(
      `INSERT INTO workspace_storage_migrations (
         workspace_id,
         requested_by_user_id,
         source_backend_id,
         target_backend_id,
         status,
         request_source
       ) VALUES ($1, $2, $3, $4, 'queued', $5)
       RETURNING id, status`,
      [
        input.workspaceId,
        input.requestedByUserId,
        sourceBackendId,
        input.targetBackendId,
        input.requestSource ?? 'manual'
      ]
    );

    return insertedRes.rows[0];
  });
}

export async function queueBulkWorkspaceStorageMigration(input: {
  targetBackendId: string;
  requestedByUserId: string;
}): Promise<{ queuedCount: number; skippedWorkspaceIds: string[] }> {
  storageBackendRegistry.getBackend(input.targetBackendId);

  const workspacesRes = await query<{ id: string }>(
    `SELECT w.id
       FROM workspaces w
      WHERE w.storage_backend_id <> $1
      ORDER BY w.created_at ASC, w.id ASC`,
    [input.targetBackendId]
  );

  let queuedCount = 0;
  const skippedWorkspaceIds: string[] = [];

  for (const workspace of workspacesRes.rows) {
    try {
      await queueWorkspaceStorageMigration({
        workspaceId: workspace.id,
        targetBackendId: input.targetBackendId,
        requestedByUserId: input.requestedByUserId,
        requestSource: "default_change_bulk"
      });
      queuedCount += 1;
    } catch {
      skippedWorkspaceIds.push(workspace.id);
    }
  }

  return {
    queuedCount,
    skippedWorkspaceIds
  };
}
