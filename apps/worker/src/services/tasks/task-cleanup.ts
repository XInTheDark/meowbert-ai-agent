import fsPromises from "node:fs/promises";
import path from "node:path";
import { isWithinPath, parseTaskCleanupSettings } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { resolveTaskEnvironmentRoot } from "../runtime/environment-storage.js";
import { deleteTaskHistoryArchive } from "./task-history.js";

const TERMINAL_TASK_STATUSES = ["succeeded", "failed", "cancelled"] as const;
const ACTIVE_TASK_STATUSES = ["queued", "starting", "running"] as const;
const INCOGNITO_TASK_RETENTION_DAYS = 1;
const TASK_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const TASK_CLEANUP_BATCH_SIZE_PER_ENV = 120;

interface CleanupEnabledEnvironmentRow {
  id: string;
  workspace_id: string;
  root_path: string;
  json_payload: unknown;
}

interface CleanupBatchDeleteResult {
  taskIds: string[];
  workspacePaths: string[];
  archiveKeys: string[];
}

export interface TaskCleanupRunSummary {
  environmentsScanned: number;
  environmentsCleaned: number;
  tasksDeleted: number;
}

function computeCutoffIso(expirationDays: number): string {
  const cutoffMs = Date.now() - expirationDays * 24 * 60 * 60 * 1000;
  return new Date(cutoffMs).toISOString();
}

function normalizeWorkspacePath(rawPath: string): string {
  return path.resolve(rawPath);
}

async function removeTaskWorkspacePaths(input: {
  envRoot: string;
  taskIds: string[];
  workspacePaths: string[];
}): Promise<void> {
  const envRoot = path.resolve(input.envRoot);
  const taskRunsRoot = path.resolve(envRoot, ".meowbert", "task-runs");
  const candidatePaths = new Set<string>();

  for (const taskId of input.taskIds) {
    candidatePaths.add(path.resolve(taskRunsRoot, taskId));
  }

  for (const rawPath of input.workspacePaths) {
    const trimmed = rawPath.trim();
    if (!trimmed) {
      continue;
    }
    candidatePaths.add(normalizeWorkspacePath(trimmed));
  }

  for (const candidatePath of candidatePaths) {
    if (candidatePath === taskRunsRoot || !isWithinPath(taskRunsRoot, candidatePath)) {
      continue;
    }

    try {
      await fsPromises.rm(candidatePath, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup only. DB rows are already deleted.
    }
  }
}

async function removeTaskArchiveFiles(archiveKeys: string[]): Promise<void> {
  const normalizedArchiveKeys = Array.from(
    new Set(
      archiveKeys
        .map((archiveKey) => archiveKey.trim())
        .filter((archiveKey) => archiveKey.length > 0)
    )
  );

  for (const archiveKey of normalizedArchiveKeys) {
    try {
      await deleteTaskHistoryArchive(archiveKey);
    } catch {
      // Best-effort cleanup only. DB rows are already deleted.
    }
  }
}

async function deleteOldTaskRows(input: {
  environmentId: string;
  cutoffIso: string;
  limit: number;
}): Promise<CleanupBatchDeleteResult> {
  return withTransaction(async (client) => {
    const candidatesRes = await client.query<{ id: string; task_history_archive_key: string | null }>(
      `SELECT t.id,
              t.task_history_archive_key
         FROM tasks t
         LEFT JOIN task_schedules ts ON ts.task_id = t.id
        WHERE t.environment_id = $1
          AND t.status = ANY($2::text[])
          AND COALESCE(t.completed_at, t.updated_at, t.created_at) < $3::timestamptz
          AND (ts.task_id IS NULL OR ts.schedule_state = 'cancelled')
        ORDER BY COALESCE(t.completed_at, t.updated_at, t.created_at) ASC, t.id ASC
        LIMIT $4
        FOR UPDATE OF t SKIP LOCKED`,
      [input.environmentId, TERMINAL_TASK_STATUSES, input.cutoffIso, input.limit]
    );

    const taskIds = candidatesRes.rows.map((row) => row.id);
    if (taskIds.length === 0) {
      return { taskIds: [], workspacePaths: [], archiveKeys: [] };
    }

    const workspacePathsRes = await client.query<{ fs_path: string }>(
      `SELECT fs_path
         FROM task_workspaces
        WHERE task_id = ANY($1::uuid[])`,
      [taskIds]
    );

    await client.query(
      `DELETE FROM tasks
        WHERE id = ANY($1::uuid[])`,
      [taskIds]
    );

    return {
      taskIds,
      workspacePaths: workspacePathsRes.rows.map((row) => row.fs_path),
      archiveKeys: candidatesRes.rows.flatMap((row) => row.task_history_archive_key ? [row.task_history_archive_key] : [])
    };
  });
}

async function deleteExpiredIncognitoTaskRows(input: {
  environmentId: string;
  limit: number;
}): Promise<CleanupBatchDeleteResult> {
  return withTransaction(async (client) => {
    const candidatesRes = await client.query<{ id: string; task_history_archive_key: string | null }>(
      `SELECT t.id,
              t.task_history_archive_key
         FROM tasks t
        WHERE t.environment_id = $1
          AND t.is_incognito = true
          AND t.created_at < $2::timestamptz
          AND t.status <> ALL($3::text[])
        ORDER BY t.created_at ASC, t.id ASC
        LIMIT $4
        FOR UPDATE OF t SKIP LOCKED`,
      [input.environmentId, computeCutoffIso(INCOGNITO_TASK_RETENTION_DAYS), ACTIVE_TASK_STATUSES, input.limit]
    );

    const taskIds = candidatesRes.rows.map((row) => row.id);
    if (taskIds.length === 0) {
      return { taskIds: [], workspacePaths: [], archiveKeys: [] };
    }

    const workspacePathsRes = await client.query<{ fs_path: string }>(
      `SELECT fs_path
         FROM task_workspaces
        WHERE task_id = ANY($1::uuid[])`,
      [taskIds]
    );

    await client.query(
      `DELETE FROM tasks
        WHERE id = ANY($1::uuid[])`,
      [taskIds]
    );

    return {
      taskIds,
      workspacePaths: workspacePathsRes.rows.map((row) => row.fs_path),
      archiveKeys: candidatesRes.rows.flatMap((row) => row.task_history_archive_key ? [row.task_history_archive_key] : [])
    };
  });
}

async function runEnvironmentCleanup(input: {
  environmentId: string;
  workspaceId: string;
  rootPath: string;
  expirationDays: number | null;
}): Promise<number> {
  const envRoot = await resolveTaskEnvironmentRoot({
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    rootPath: input.rootPath
  });
  const deleted = input.expirationDays
    ? await deleteOldTaskRows({
        environmentId: input.environmentId,
        cutoffIso: computeCutoffIso(input.expirationDays),
        limit: TASK_CLEANUP_BATCH_SIZE_PER_ENV
      })
    : { taskIds: [], workspacePaths: [], archiveKeys: [] };
  const deletedIncognito = await deleteExpiredIncognitoTaskRows({
    environmentId: input.environmentId,
    limit: TASK_CLEANUP_BATCH_SIZE_PER_ENV
  });
  const combinedDeleted = {
    taskIds: [...deleted.taskIds, ...deletedIncognito.taskIds],
    workspacePaths: [...deleted.workspacePaths, ...deletedIncognito.workspacePaths],
    archiveKeys: [...deleted.archiveKeys, ...deletedIncognito.archiveKeys]
  };

  if (combinedDeleted.taskIds.length === 0) {
    return 0;
  }

  await removeTaskWorkspacePaths({
    envRoot,
    taskIds: combinedDeleted.taskIds,
    workspacePaths: combinedDeleted.workspacePaths
  });
  await removeTaskArchiveFiles(combinedDeleted.archiveKeys);

  return combinedDeleted.taskIds.length;
}

export async function runTaskCleanupOnce(): Promise<TaskCleanupRunSummary> {
  const environmentsRes = await query<CleanupEnabledEnvironmentRow>(
    `SELECT id, workspace_id, root_path, json_payload
       FROM environments
      ORDER BY updated_at DESC, id DESC`
  );

  let environmentsScanned = 0;
  let environmentsCleaned = 0;
  let tasksDeleted = 0;

  for (const environment of environmentsRes.rows) {
    const expirationDays = parseTaskCleanupSettings(environment.json_payload).expirationDays;
    environmentsScanned += 1;
    try {
      const deletedCount = await runEnvironmentCleanup({
        environmentId: environment.id,
        workspaceId: environment.workspace_id,
        rootPath: environment.root_path,
        expirationDays
      });

      if (deletedCount > 0) {
        environmentsCleaned += 1;
        tasksDeleted += deletedCount;
      }
    } catch (error) {
      console.error(`[cleanup] Failed to clean environment ${environment.id}`, error);
    }
  }

  return {
    environmentsScanned,
    environmentsCleaned,
    tasksDeleted
  };
}

export function startTaskCleanupLoop(): { stop: () => Promise<void> } {
  let stopping = false;
  let running = false;
  let interval: NodeJS.Timeout | null = null;
  let pendingRun: Promise<void> | null = null;

  const runOnce = async (): Promise<void> => {
    if (stopping || running) {
      return;
    }

    running = true;
    pendingRun = runTaskCleanupOnce()
      .then((summary) => {
        if (summary.tasksDeleted > 0) {
          console.log(
            `[cleanup] Deleted ${summary.tasksDeleted} old task(s) across ${summary.environmentsCleaned}/${summary.environmentsScanned} environment(s)`
          );
        }
      })
      .catch((error) => {
        console.error("[cleanup] Task cleanup loop failed", error);
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
  }, TASK_CLEANUP_INTERVAL_MS);

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
