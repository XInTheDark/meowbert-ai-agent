import os from "node:os";
import { isStoragePathEmpty } from "@meowbert/shared/storage-backend-runtime";
import { query, withTransaction } from "../../lib/db.js";
import { resolveManagedTaskEnvironmentRoot, resolveTaskEnvironmentRoot } from "../runtime/environment-storage.js";
import { resolveManagedTaskWorkspaceRoot, resolveTaskWorkspaceRoot } from "../workspaces/workspace-storage.js";
import { copyDirectoryContents, resetManagedStorageRoot } from "./migration-filesystem.js";

const WORKSPACE_STORAGE_MIGRATION_INTERVAL_MS = 5_000;
const WORKSPACE_STORAGE_MIGRATION_HEARTBEAT_INTERVAL_MS = 5_000;
const WORKSPACE_STORAGE_MIGRATION_STALE_AFTER_SECONDS = 30;
const WORKSPACE_STORAGE_MIGRATION_RECOVERY_BATCH_SIZE = 10;
const WORKSPACE_STORAGE_MIGRATION_WORKER_ID = `storage-migration:${os.hostname()}:${process.pid}`;

type WorkspaceStorageMigrationStatus = "queued" | "running" | "failed" | "completed" | "cancelled";
type WorkspaceStorageMigrationRequestSource = "manual" | "default_change_bulk";

interface ClaimedWorkspaceStorageMigration {
  id: string;
  workspace_id: string;
  requested_by_user_id: string | null;
  source_backend_id: string;
  target_backend_id: string;
  request_source: WorkspaceStorageMigrationRequestSource;
}

interface WorkspaceEnvironmentRow {
  id: string;
  workspace_id: string;
  root_path: string;
}

interface WorkspaceRow {
  id: string;
  root_path: string;
  storage_backend_id: string;
}

function formatMigrationError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 1000 ? `${text.slice(0, 997)}...` : text;
}

async function claimQueuedWorkspaceStorageMigration(workerId: string): Promise<ClaimedWorkspaceStorageMigration | null> {
  return withTransaction(async (client) => {
    const candidateRes = await client.query<{ id: string }>(
      `SELECT id
         FROM workspace_storage_migrations
        WHERE status = 'queued'
        ORDER BY updated_at ASC, created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`
    );

    const candidateId = candidateRes.rows[0]?.id;
    if (!candidateId) {
      return null;
    }

    const claimedRes = await client.query<ClaimedWorkspaceStorageMigration>(
      `UPDATE workspace_storage_migrations
          SET status = 'running',
              started_at = now(),
              completed_at = NULL,
              updated_at = now(),
              error_summary = NULL,
              worker_id = $2,
              heartbeat_at = now()
        WHERE id = $1
        RETURNING id, workspace_id, requested_by_user_id, source_backend_id, target_backend_id, request_source`,
      [candidateId, workerId]
    );

    return claimedRes.rows[0] ?? null;
  });
}

async function claimStaleRunningWorkspaceStorageMigration(workerId: string): Promise<ClaimedWorkspaceStorageMigration | null> {
  return withTransaction(async (client) => {
    const candidateRes = await client.query<{ id: string }>(
      `SELECT id
         FROM workspace_storage_migrations
        WHERE status = 'running'
          AND (
            (heartbeat_at IS NOT NULL AND heartbeat_at < now() - interval '${WORKSPACE_STORAGE_MIGRATION_STALE_AFTER_SECONDS} seconds')
            OR (heartbeat_at IS NULL AND updated_at < now() - interval '${WORKSPACE_STORAGE_MIGRATION_STALE_AFTER_SECONDS} seconds')
          )
        ORDER BY COALESCE(heartbeat_at, updated_at, started_at, created_at) ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`
    );

    const candidateId = candidateRes.rows[0]?.id;
    if (!candidateId) {
      return null;
    }

    const claimedRes = await client.query<ClaimedWorkspaceStorageMigration>(
      `UPDATE workspace_storage_migrations
          SET updated_at = now(),
              error_summary = NULL,
              worker_id = $2,
              heartbeat_at = now()
        WHERE id = $1
        RETURNING id, workspace_id, requested_by_user_id, source_backend_id, target_backend_id, request_source`,
      [candidateId, workerId]
    );

    return claimedRes.rows[0] ?? null;
  });
}

async function markWorkspaceStorageMigrationStatus(input: {
  migrationId: string;
  status: Extract<WorkspaceStorageMigrationStatus, "failed" | "completed">;
  errorSummary?: string | null;
}): Promise<void> {
  await query(
    `UPDATE workspace_storage_migrations
        SET status = $2,
            error_summary = $3,
            completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END,
            updated_at = now(),
            worker_id = NULL,
            heartbeat_at = NULL
      WHERE id = $1`,
    [input.migrationId, input.status, input.errorSummary ?? null]
  );
}

async function markWorkspaceStorageMigrationQueued(migrationId: string): Promise<void> {
  await query(
    `UPDATE workspace_storage_migrations
        SET status = 'queued',
            started_at = NULL,
            completed_at = NULL,
            updated_at = now(),
            error_summary = NULL,
            worker_id = NULL,
            heartbeat_at = NULL
      WHERE id = $1`,
    [migrationId]
  );
}

async function beatWorkspaceStorageMigrationHeartbeat(migrationId: string, workerId: string): Promise<void> {
  await query(
    `UPDATE workspace_storage_migrations
        SET heartbeat_at = now(),
            updated_at = now()
      WHERE id = $1
        AND status = 'running'
        AND worker_id = $2`,
    [migrationId, workerId]
  );
}

async function runWithWorkspaceStorageMigrationHeartbeat<T>(
  migrationId: string,
  workerId: string,
  callback: () => Promise<T>
): Promise<T> {
  let interval: NodeJS.Timeout | null = null;

  const heartbeat = async (): Promise<void> => {
    await beatWorkspaceStorageMigrationHeartbeat(migrationId, workerId).catch((error) => {
      console.warn(`[storage] Failed to heartbeat workspace storage migration ${migrationId}`, error);
    });
  };

  await heartbeat();
  interval = setInterval(() => {
    void heartbeat();
  }, WORKSPACE_STORAGE_MIGRATION_HEARTBEAT_INTERVAL_MS);

  try {
    return await callback();
  } finally {
    if (interval) {
      clearInterval(interval);
    }
  }
}

async function loadWorkspaceMigrationState(migration: ClaimedWorkspaceStorageMigration): Promise<{
  workspace: WorkspaceRow;
  environments: WorkspaceEnvironmentRow[];
}> {
  const [workspaceRes, environmentsRes] = await Promise.all([
    query<WorkspaceRow>(
      `SELECT id, root_path, storage_backend_id
         FROM workspaces
        WHERE id = $1`,
      [migration.workspace_id]
    ),
    query<WorkspaceEnvironmentRow>(
      `SELECT id, workspace_id, root_path
         FROM environments
        WHERE workspace_id = $1
        ORDER BY created_at ASC, id ASC`,
      [migration.workspace_id]
    )
  ]);

  if ((workspaceRes.rowCount ?? 0) === 0) {
    throw new Error("Workspace not found");
  }
  if (workspaceRes.rows[0].storage_backend_id !== migration.source_backend_id
    || migration.source_backend_id === migration.target_backend_id) {
    throw new Error("Workspace storage no longer matches the migration source; refusing to clear the target.");
  }

  return {
    workspace: workspaceRes.rows[0],
    environments: environmentsRes.rows
  };
}

async function recoverInterruptedWorkspaceStorageMigration(migration: ClaimedWorkspaceStorageMigration): Promise<void> {
  const state = await loadWorkspaceMigrationState(migration);
  const targetWorkspaceRoot = await resolveManagedTaskWorkspaceRoot({
    workspaceId: state.workspace.id,
    storageBackendId: migration.target_backend_id
  });

  await resetManagedStorageRoot(targetWorkspaceRoot);

  for (const environment of state.environments) {
    const targetEnvironmentRoot = await resolveManagedTaskEnvironmentRoot({
      workspaceId: environment.workspace_id,
      environmentId: environment.id,
      storageBackendId: migration.target_backend_id
    });

    await resetManagedStorageRoot(targetEnvironmentRoot);
  }
}

async function ensureEmptyManagedStorageRoot(rootPath: string): Promise<void> {
  if (await isStoragePathEmpty(rootPath)) {
    return;
  }

  await resetManagedStorageRoot(rootPath);
}

export async function recoverStaleWorkspaceStorageMigrationsOnce(
  workerId = WORKSPACE_STORAGE_MIGRATION_WORKER_ID
): Promise<number> {
  let recoveredCount = 0;

  for (let index = 0; index < WORKSPACE_STORAGE_MIGRATION_RECOVERY_BATCH_SIZE; index += 1) {
    const migration = await claimStaleRunningWorkspaceStorageMigration(workerId);
    if (!migration) {
      return recoveredCount;
    }

    try {
      await runWithWorkspaceStorageMigrationHeartbeat(migration.id, workerId, async () => {
        await recoverInterruptedWorkspaceStorageMigration(migration);
      });
      await markWorkspaceStorageMigrationQueued(migration.id);
      recoveredCount += 1;
    } catch (error) {
      await markWorkspaceStorageMigrationStatus({
        migrationId: migration.id,
        status: "failed",
        errorSummary: `Failed to recover interrupted workspace storage migration after worker restart: ${formatMigrationError(error)}`
      });
      console.error(`[storage] Failed to recover interrupted workspace storage migration ${migration.id}`, error);
    }
  }

  return recoveredCount;
}

async function performWorkspaceStorageMigration(migration: ClaimedWorkspaceStorageMigration): Promise<void> {
  const state = await loadWorkspaceMigrationState(migration);
  const sourceWorkspaceRoot = await resolveTaskWorkspaceRoot({
    workspaceId: state.workspace.id,
    rootPath: state.workspace.root_path,
    storageBackendId: migration.source_backend_id
  });
  const targetWorkspaceRoot = await resolveManagedTaskWorkspaceRoot({
    workspaceId: state.workspace.id,
    storageBackendId: migration.target_backend_id
  });

  await ensureEmptyManagedStorageRoot(targetWorkspaceRoot);

  await copyDirectoryContents(sourceWorkspaceRoot, targetWorkspaceRoot);

  const nextEnvironmentRoots = new Map<string, string>();
  for (const environment of state.environments) {
    const sourceEnvironmentRoot = await resolveTaskEnvironmentRoot({
      workspaceId: environment.workspace_id,
      environmentId: environment.id,
      rootPath: environment.root_path,
      storageBackendId: migration.source_backend_id
    });
    const targetEnvironmentRoot = await resolveManagedTaskEnvironmentRoot({
      workspaceId: environment.workspace_id,
      environmentId: environment.id,
      storageBackendId: migration.target_backend_id
    });

    await ensureEmptyManagedStorageRoot(targetEnvironmentRoot);

    await copyDirectoryContents(sourceEnvironmentRoot, targetEnvironmentRoot);
    nextEnvironmentRoots.set(environment.id, targetEnvironmentRoot);
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE workspaces
          SET storage_backend_id = $2,
              root_path = $3,
              updated_at = now()
        WHERE id = $1`,
      [state.workspace.id, migration.target_backend_id, targetWorkspaceRoot]
    );

    for (const environment of state.environments) {
      const targetEnvironmentRoot = nextEnvironmentRoots.get(environment.id);
      if (!targetEnvironmentRoot) {
        throw new Error(`Missing migrated environment root for ${environment.id}`);
      }

      await client.query(
        `UPDATE environments
            SET root_path = $2,
                updated_at = now()
          WHERE id = $1`,
        [environment.id, targetEnvironmentRoot]
      );
    }

    await client.query(
      `UPDATE workspace_storage_migrations
          SET status = 'completed',
              completed_at = now(),
              updated_at = now(),
              error_summary = NULL,
              worker_id = NULL,
              heartbeat_at = NULL
        WHERE id = $1`,
      [migration.id]
    );
  });
}

export async function runWorkspaceStorageMigrationLoopOnce(
  workerId = WORKSPACE_STORAGE_MIGRATION_WORKER_ID
): Promise<boolean> {
  const migration = await claimQueuedWorkspaceStorageMigration(workerId);
  if (!migration) {
    return false;
  }

  try {
    await runWithWorkspaceStorageMigrationHeartbeat(migration.id, workerId, async () => performWorkspaceStorageMigration(migration));
  } catch (error) {
    await markWorkspaceStorageMigrationStatus({
      migrationId: migration.id,
      status: "failed",
      errorSummary: formatMigrationError(error)
    });
    console.error(`[storage] Workspace storage migration failed for workspace ${migration.workspace_id}`, error);
  }

  return true;
}

export function startWorkspaceStorageMigrationLoop(): { stop: () => Promise<void> } {
  let stopping = false;
  let running = false;
  let interval: NodeJS.Timeout | null = null;
  let pendingRun: Promise<void> | null = null;

  const runOnce = async (): Promise<void> => {
    if (stopping || running) {
      return;
    }

    running = true;
    pendingRun = (async () => {
      const recoveredCount = await recoverStaleWorkspaceStorageMigrationsOnce();
      if (recoveredCount > 0) {
        console.log(`[storage] Recovered ${recoveredCount} interrupted workspace storage migration(s)`);
      }
      await runWorkspaceStorageMigrationLoopOnce();
    })()
      .catch((error) => {
        console.error("[storage] Workspace storage migration loop failed", error);
      })
      .finally(() => {
        running = false;
        pendingRun = null;
      });

    await pendingRun;
  };

  void runOnce();
  interval = setInterval(() => {
    void runOnce();
  }, WORKSPACE_STORAGE_MIGRATION_INTERVAL_MS);

  return {
    stop: async (): Promise<void> => {
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
