import path from "node:path";
import { query, withTransaction } from "../../lib/db.js";
import { storageBackendRegistry } from "../storage/backend-registry.js";
import {
  inspectConfiguredLocalXfsProjectQuotaBackend,
  listConfiguredLocalXfsProjectQuotaBackends
} from "../storage/local-xfs-project-quotas.js";

export type AdminRuntimeMigrationKey = "nest_environment_roots" | "provision_local_xfs_project_quotas";
export type AdminRuntimeMigrationStatus = "ready" | "up_to_date" | "action_required" | "queued" | "running" | "failed";

interface AdminRuntimeMigrationRunRow {
  id: string;
  migration_key: AdminRuntimeMigrationKey;
  status: "queued" | "running" | "failed" | "completed" | "cancelled";
  error_summary: string | null;
  summary_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface EnvironmentMigrationCandidateRow {
  id: string;
  workspace_id: string;
  root_path: string;
  storage_backend_id: string;
}

interface XfsWorkspaceRow {
  id: string;
  root_path: string;
  storage_backend_id: string;
  storage_project_id: number | null;
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
  key: AdminRuntimeMigrationKey;
  title: string;
  description: string;
  status: AdminRuntimeMigrationStatus;
  blockedReason: string | null;
  pendingItems: number;
  detail: string;
  latestRun: AdminRuntimeMigrationRunSummary | null;
}

function mapLatestRun(row: AdminRuntimeMigrationRunRow | undefined): AdminRuntimeMigrationRunSummary | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    status: row.status,
    errorSummary: row.error_summary,
    summary: row.summary_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

function deriveMigrationStatus(input: {
  blockedReason: string | null;
  pendingItems: number;
  latestRun: AdminRuntimeMigrationRunSummary | null;
}): AdminRuntimeMigrationStatus {
  if (input.latestRun?.status === "queued") {
    return "queued";
  }
  if (input.latestRun?.status === "running") {
    return "running";
  }
  if (input.blockedReason) {
    return "action_required";
  }
  if (input.pendingItems === 0) {
    return "up_to_date";
  }
  if (input.latestRun?.status === "failed") {
    return "failed";
  }
  return "ready";
}

async function listLatestMigrationRuns(): Promise<Map<AdminRuntimeMigrationKey, AdminRuntimeMigrationRunRow>> {
  const runsRes = await query<AdminRuntimeMigrationRunRow>(
    `SELECT DISTINCT ON (migration_key)
            id,
            migration_key,
            status,
            error_summary,
            summary_json,
            created_at::text,
            updated_at::text,
            started_at::text,
            completed_at::text
       FROM admin_runtime_migrations
      ORDER BY migration_key ASC, created_at DESC, id DESC`
  );

  return new Map(runsRes.rows.map((row) => [row.migration_key, row]));
}

async function countPendingEnvironmentRootMigrations(): Promise<number> {
  const environmentsRes = await query<EnvironmentMigrationCandidateRow>(
    `SELECT e.id,
            e.workspace_id,
            e.root_path,
            w.storage_backend_id
       FROM environments e
       JOIN workspaces w ON w.id = e.workspace_id
      ORDER BY e.created_at ASC, e.id ASC`
  );

  let pendingCount = 0;
  for (const environment of environmentsRes.rows) {
    const targetRoot = storageBackendRegistry.resolveManagedEnvironmentRoot(
      environment.storage_backend_id,
      environment.workspace_id,
      environment.id
    );
    const currentRoot = environment.root_path.trim();
    if (!currentRoot) {
      pendingCount += 1;
      continue;
    }

    if (path.resolve(currentRoot) !== targetRoot) {
      pendingCount += 1;
    }
  }

  return pendingCount;
}

async function summarizeEnvironmentRootMigration(
  latestRuns: Map<AdminRuntimeMigrationKey, AdminRuntimeMigrationRunRow>
): Promise<AdminRuntimeMigrationSummary> {
  const pendingItems = await countPendingEnvironmentRootMigrations();
  const latestRun = mapLatestRun(latestRuns.get("nest_environment_roots"));

  return {
    key: "nest_environment_roots",
    title: "Nest environments under workspace storage units",
    description: "Moves legacy environment roots into each workspace storage unit so workspace-level quotas can cover environment data too.",
    status: deriveMigrationStatus({
      blockedReason: null,
      pendingItems,
      latestRun
    }),
    blockedReason: null,
    pendingItems,
    detail:
      pendingItems > 0
        ? `${pendingItems} environment root${pendingItems === 1 ? "" : "s"} still use the legacy layout.`
        : "All environment roots already live under their workspace storage units.",
    latestRun
  };
}

async function summarizeLocalXfsProjectQuotaMigration(
  latestRuns: Map<AdminRuntimeMigrationKey, AdminRuntimeMigrationRunRow>,
  pendingEnvironmentRootItems: number
): Promise<AdminRuntimeMigrationSummary> {
  const xfsBackends = listConfiguredLocalXfsProjectQuotaBackends();
  const latestRun = mapLatestRun(latestRuns.get("provision_local_xfs_project_quotas"));

  if (xfsBackends.length === 0) {
    return {
      key: "provision_local_xfs_project_quotas",
      title: "Migrate local workspaces to XFS storage units",
      description: "Moves local workspace roots onto the configured XFS-backed managed path and provisions hard project quotas.",
      status: deriveMigrationStatus({
        blockedReason: "Configure an explicit local backend with xfsProjectQuota first.",
        pendingItems: 0,
        latestRun
      }),
      blockedReason: "Configure an explicit local backend with xfsProjectQuota first.",
      pendingItems: 0,
      detail: "No local backend in config currently has xfsProjectQuota enabled.",
      latestRun
    };
  }

  if (pendingEnvironmentRootItems > 0) {
    return {
      key: "provision_local_xfs_project_quotas",
      title: "Migrate local workspaces to XFS storage units",
      description: "Moves local workspace roots onto the configured XFS-backed managed path and provisions hard project quotas.",
      status: deriveMigrationStatus({
        blockedReason: "Run the environment nesting migration first so quotas cover environment data too.",
        pendingItems: 0,
        latestRun
      }),
      blockedReason: "Run the environment nesting migration first so quotas cover environment data too.",
      pendingItems: 0,
      detail: "Environment data must be moved under workspace storage units before hard quotas can be trusted.",
      latestRun
    };
  }

  const backendStatuses = await Promise.all(
    xfsBackends.map(async (backend) => ({
      backendId: backend.id,
      status: await inspectConfiguredLocalXfsProjectQuotaBackend(backend.id).catch((error) => ({
        ready: false,
        message: error instanceof Error ? error.message : String(error)
      }))
    }))
  );
  const failedBackend = backendStatuses.find((entry) => !entry.status.ready);
  if (failedBackend) {
    return {
      key: "provision_local_xfs_project_quotas",
      title: "Migrate local workspaces to XFS storage units",
      description: "Moves local workspace roots onto the configured XFS-backed managed path and provisions hard project quotas.",
      status: deriveMigrationStatus({
        blockedReason: failedBackend.status.message,
        pendingItems: 0,
        latestRun
      }),
      blockedReason: failedBackend.status.message,
      pendingItems: 0,
      detail: `Backend ${failedBackend.backendId} is not ready for xfs quotas.`,
      latestRun
    };
  }

  const backendIds = xfsBackends.map((backend) => backend.id);
  const workspacesRes = await query<XfsWorkspaceRow>(
    `SELECT id, root_path, storage_backend_id, storage_project_id
       FROM workspaces
      WHERE storage_backend_id = ANY($1::text[])
      ORDER BY created_at ASC, id ASC`,
    [backendIds]
  );
  const pendingItems = workspacesRes.rows.filter((workspace) => {
    const currentRoot = workspace.root_path.trim();
    const targetRoot = storageBackendRegistry.resolveManagedWorkspaceRoot(workspace.storage_backend_id, workspace.id);
    const needsWorkspaceMove = !currentRoot || path.resolve(currentRoot) !== targetRoot;
    const needsProjectId = workspace.storage_project_id === null;
    return needsWorkspaceMove || needsProjectId;
  }).length;

  return {
    key: "provision_local_xfs_project_quotas",
    title: "Migrate local workspaces to XFS storage units",
    description: "Moves local workspace roots onto the configured XFS-backed managed path and provisions hard project quotas.",
    status: deriveMigrationStatus({
      blockedReason: null,
      pendingItems,
      latestRun
    }),
    blockedReason: null,
    pendingItems,
    detail:
      pendingItems > 0
        ? `${pendingItems} workspace${pendingItems === 1 ? "" : "s"} still need to move onto the managed xfs path and/or receive a project quota.`
        : workspacesRes.rows.length > 0
          ? "All xfs-backed local workspaces already use the managed xfs path and have project quotas provisioned."
          : "No workspaces currently use the configured xfs-backed local backend.",
    latestRun
  };
}

export async function listAdminRuntimeMigrations(): Promise<AdminRuntimeMigrationSummary[]> {
  const latestRuns = await listLatestMigrationRuns();
  const environmentMigration = await summarizeEnvironmentRootMigration(latestRuns);
  const xfsMigration = await summarizeLocalXfsProjectQuotaMigration(latestRuns, environmentMigration.pendingItems);
  return [environmentMigration, xfsMigration];
}

export async function queueAdminRuntimeMigration(input: {
  migrationKey: AdminRuntimeMigrationKey;
  requestedByUserId: string;
}): Promise<AdminRuntimeMigrationRunSummary> {
  const overview = await listAdminRuntimeMigrations();
  const targetMigration = overview.find((migration) => migration.key === input.migrationKey);
  if (!targetMigration) {
    throw new Error(`Unknown admin migration: ${input.migrationKey}`);
  }
  if (targetMigration.blockedReason) {
    throw new Error(targetMigration.blockedReason);
  }

  return withTransaction(async (client) => {
    const activeRes = await client.query<{ id: string }>(
      `SELECT id
         FROM admin_runtime_migrations
        WHERE migration_key = $1
          AND status IN ('queued', 'running')
        LIMIT 1`,
      [input.migrationKey]
    );
    if ((activeRes.rowCount ?? 0) > 0) {
      throw new Error("This migration already has a queued or running job.");
    }

    const insertedRes = await client.query<AdminRuntimeMigrationRunRow>(
      `INSERT INTO admin_runtime_migrations (
         migration_key,
         requested_by_user_id,
         status
       ) VALUES ($1, $2, 'queued')
       RETURNING id,
                 migration_key,
                 status,
                 error_summary,
                 summary_json,
                 created_at::text,
                 updated_at::text,
                 started_at::text,
                 completed_at::text`,
      [input.migrationKey, input.requestedByUserId]
    );

    return mapLatestRun(insertedRes.rows[0])!;
  });
}
