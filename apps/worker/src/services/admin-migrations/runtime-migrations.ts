import fsPromises from "node:fs/promises";
import path from "node:path";
import { isStoragePathEmpty } from "@meowbert/shared/storage-backend-runtime";
import { query, withTransaction } from "../../lib/db.js";
import { storageBackendRegistry } from "../storage/backend-registry.js";
import { ensureWorkspaceLocalXfsProjectQuota, listConfiguredLocalXfsProjectQuotaBackends } from "../storage/local-xfs-project-quotas.js";
import { ensureNoActiveTasksForWorkspaces } from "../tasks/task-cancellation.js";

const ADMIN_RUNTIME_MIGRATION_INTERVAL_MS = 5_000;

type AdminRuntimeMigrationKey = "nest_environment_roots" | "provision_local_xfs_project_quotas";

interface ClaimedAdminRuntimeMigration {
  id: string;
  migration_key: AdminRuntimeMigrationKey;
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
}

function formatMigrationError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 1000 ? `${text.slice(0, 997)}...` : text;
}

async function copyDirectoryContents(sourceRoot: string, targetRoot: string): Promise<void> {
  const entries = await fsPromises.readdir(sourceRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    await fsPromises.cp(sourcePath, targetPath, {
      recursive: true,
      errorOnExist: true,
      force: false
    });
  }
}

async function moveDirectoryTree(sourceRoot: string, targetRoot: string): Promise<void> {
  if (path.resolve(sourceRoot) === path.resolve(targetRoot)) {
    return;
  }

  await fsPromises.mkdir(path.dirname(targetRoot), { recursive: true });

  try {
    await fsPromises.rename(sourceRoot, targetRoot);
    return;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

    if (code === "ENOENT") {
      await fsPromises.mkdir(targetRoot, { recursive: true });
      return;
    }

    if (code !== "EXDEV" && code !== "EEXIST" && code !== "ENOTEMPTY") {
      throw error;
    }
  }

  await fsPromises.mkdir(targetRoot, { recursive: true });
  await copyDirectoryContents(sourceRoot, targetRoot);
  await fsPromises.rm(sourceRoot, { recursive: true, force: true });
}

async function claimQueuedAdminRuntimeMigration(): Promise<ClaimedAdminRuntimeMigration | null> {
  return withTransaction(async (client) => {
    const candidateRes = await client.query<{ id: string }>(
      `SELECT id
         FROM admin_runtime_migrations
        WHERE status = 'queued'
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`
    );

    const candidateId = candidateRes.rows[0]?.id;
    if (!candidateId) {
      return null;
    }

    const claimedRes = await client.query<ClaimedAdminRuntimeMigration>(
      `UPDATE admin_runtime_migrations
          SET status = 'running',
              started_at = now(),
              updated_at = now(),
              error_summary = NULL
        WHERE id = $1
        RETURNING id, migration_key`,
      [candidateId]
    );

    return claimedRes.rows[0] ?? null;
  });
}

async function updateAdminRuntimeMigrationProgress(input: {
  migrationId: string;
  totalItems: number;
  completedItems: number;
  extraSummary?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `UPDATE admin_runtime_migrations
        SET summary_json = $2::jsonb,
            updated_at = now()
      WHERE id = $1`,
    [
      input.migrationId,
      JSON.stringify({
        totalItems: input.totalItems,
        completedItems: input.completedItems,
        ...(input.extraSummary ?? {})
      })
    ]
  );
}

async function markAdminRuntimeMigrationStatus(input: {
  migrationId: string;
  status: "failed" | "completed";
  errorSummary?: string | null;
  summary?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `UPDATE admin_runtime_migrations
        SET status = $2,
            error_summary = $3,
            summary_json = COALESCE($4::jsonb, summary_json),
            completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END,
            updated_at = now()
      WHERE id = $1`,
    [
      input.migrationId,
      input.status,
      input.errorSummary ?? null,
      input.summary ? JSON.stringify(input.summary) : null
    ]
  );
}

async function loadPendingEnvironmentMigrationCandidates(): Promise<Array<EnvironmentMigrationCandidateRow & { target_root: string }>> {
  const candidatesRes = await query<EnvironmentMigrationCandidateRow>(
    `SELECT e.id,
            e.workspace_id,
            e.root_path,
            w.storage_backend_id
       FROM environments e
       JOIN workspaces w ON w.id = e.workspace_id
      ORDER BY e.created_at ASC, e.id ASC`
  );

  const pending: Array<EnvironmentMigrationCandidateRow & { target_root: string }> = [];
  for (const environment of candidatesRes.rows) {
    const targetRoot = storageBackendRegistry.resolveManagedEnvironmentRoot(
      environment.storage_backend_id,
      environment.workspace_id,
      environment.id
    );
    const currentRoot = environment.root_path.trim();
    if (!currentRoot || path.resolve(currentRoot) !== targetRoot) {
      pending.push({
        ...environment,
        target_root: targetRoot
      });
    }
  }

  return pending;
}

async function runNestEnvironmentRootsMigration(migrationId: string): Promise<void> {
  const candidates = await loadPendingEnvironmentMigrationCandidates();
  const affectedWorkspaceIds = Array.from(new Set(candidates.map((candidate) => candidate.workspace_id)));
  const taskCancellation = await ensureNoActiveTasksForWorkspaces({
    workspaceIds: affectedWorkspaceIds,
    cancellationMessage: "Task cancelled by admin migration: environment roots are being moved.",
    timeoutBehavior: "continue"
  });
  if (taskCancellation.waitTimedOut) {
    console.warn(
      `[admin-migrations] Continuing nest_environment_roots migration ${migrationId} after task cancellation wait timed out with ${taskCancellation.remainingActiveTaskCount} active task(s) still present.`
    );
  }

  await updateAdminRuntimeMigrationProgress({
    migrationId,
    totalItems: candidates.length,
    completedItems: 0
  });

  let completedItems = 0;
  for (const environment of candidates) {
    await storageBackendRegistry.ensureBackendReady(environment.storage_backend_id);

    const sourceRoot = environment.root_path.trim();
    const targetRoot = environment.target_root;
    if (!sourceRoot) {
      await fsPromises.mkdir(targetRoot, { recursive: true });
    } else {
      await moveDirectoryTree(path.resolve(sourceRoot), targetRoot);
    }

    await query(
      `UPDATE environments
          SET root_path = $2,
              updated_at = now()
        WHERE id = $1`,
      [environment.id, targetRoot]
    );

    completedItems += 1;
    await updateAdminRuntimeMigrationProgress({
      migrationId,
      totalItems: candidates.length,
      completedItems
    });
  }

  await markAdminRuntimeMigrationStatus({
    migrationId,
    status: "completed",
    summary: {
      totalItems: candidates.length,
      completedItems
    }
  });
}

async function loadLocalXfsQuotaWorkspaces(): Promise<XfsWorkspaceRow[]> {
  const backendIds = listConfiguredLocalXfsProjectQuotaBackends().map((backend) => backend.id);
  if (backendIds.length === 0) {
    return [];
  }

  const workspacesRes = await query<XfsWorkspaceRow>(
    `SELECT id, root_path, storage_backend_id
       FROM workspaces
      WHERE storage_backend_id = ANY($1::text[])
      ORDER BY created_at ASC, id ASC`,
    [backendIds]
  );

  return workspacesRes.rows;
}

async function runProvisionLocalXfsProjectQuotaMigration(migrationId: string): Promise<void> {
  const workspaces = await loadLocalXfsQuotaWorkspaces();
  await ensureNoActiveTasksForWorkspaces({
    workspaceIds: workspaces.map((workspace) => workspace.id),
    cancellationMessage: "Task cancelled by admin migration: workspace storage is being moved onto XFS."
  });

  await updateAdminRuntimeMigrationProgress({
    migrationId,
    totalItems: workspaces.length,
    completedItems: 0
  });

  let completedItems = 0;
  for (const workspace of workspaces) {
    await storageBackendRegistry.ensureBackendReady(workspace.storage_backend_id);

    const targetWorkspaceRoot = storageBackendRegistry.resolveManagedWorkspaceRoot(
      workspace.storage_backend_id,
      workspace.id
    );
    const currentRoot = workspace.root_path.trim();

    if (!currentRoot) {
      await fsPromises.mkdir(targetWorkspaceRoot, { recursive: true });
      await query(
        `UPDATE workspaces
            SET root_path = $2,
                updated_at = now()
          WHERE id = $1`,
        [workspace.id, targetWorkspaceRoot]
      );
    } else {
      const resolvedCurrentRoot = path.resolve(currentRoot);
      if (resolvedCurrentRoot !== targetWorkspaceRoot) {
        if (!(await isStoragePathEmpty(targetWorkspaceRoot))) {
          throw new Error(`Target xfs workspace root is not empty: ${targetWorkspaceRoot}`);
        }

        await moveDirectoryTree(resolvedCurrentRoot, targetWorkspaceRoot);
        await query(
          `UPDATE workspaces
              SET root_path = $2,
                  updated_at = now()
            WHERE id = $1`,
          [workspace.id, targetWorkspaceRoot]
        );
      } else {
        await fsPromises.mkdir(targetWorkspaceRoot, { recursive: true });
      }
    }

    await ensureWorkspaceLocalXfsProjectQuota({
      workspaceId: workspace.id,
      storageBackendId: workspace.storage_backend_id,
      workspaceRoot: targetWorkspaceRoot
    });

    completedItems += 1;
    await updateAdminRuntimeMigrationProgress({
      migrationId,
      totalItems: workspaces.length,
      completedItems
    });
  }

  await markAdminRuntimeMigrationStatus({
    migrationId,
    status: "completed",
    summary: {
      totalItems: workspaces.length,
      completedItems
    }
  });
}

async function performAdminRuntimeMigration(migration: ClaimedAdminRuntimeMigration): Promise<void> {
  if (migration.migration_key === "nest_environment_roots") {
    await runNestEnvironmentRootsMigration(migration.id);
    return;
  }

  await runProvisionLocalXfsProjectQuotaMigration(migration.id);
}

export async function runAdminRuntimeMigrationLoopOnce(): Promise<boolean> {
  const migration = await claimQueuedAdminRuntimeMigration();
  if (!migration) {
    return false;
  }

  try {
    await performAdminRuntimeMigration(migration);
  } catch (error) {
    await markAdminRuntimeMigrationStatus({
      migrationId: migration.id,
      status: "failed",
      errorSummary: formatMigrationError(error)
    });
    console.error(`[admin-migrations] Runtime migration failed for ${migration.migration_key}`, error);
  }

  return true;
}

export function startAdminRuntimeMigrationLoop(): { stop: () => Promise<void> } {
  let stopping = false;
  let running = false;
  let interval: NodeJS.Timeout | null = null;
  let pendingRun: Promise<void> | null = null;

  const runOnce = async (): Promise<void> => {
    if (stopping || running) {
      return;
    }

    running = true;
    pendingRun = runAdminRuntimeMigrationLoopOnce()
      .then(() => undefined)
      .catch((error) => {
        console.error("[admin-migrations] Runtime migration loop failed", error);
      })
      .finally(() => {
        running = false;
        pendingRun = null;
      });

    await pendingRun;
  };

  interval = setInterval(() => {
    void runOnce();
  }, ADMIN_RUNTIME_MIGRATION_INTERVAL_MS);
  void runOnce();

  return {
    stop: async () => {
      stopping = true;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (pendingRun) {
        await pendingRun;
      }
    }
  };
}
