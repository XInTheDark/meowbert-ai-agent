import fsPromises from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import {
  isWithinPath,
  parseTaskCleanupSettings,
  TASK_CLEANUP_EXPIRATION_DAYS_MAX,
  TASK_CLEANUP_EXPIRATION_DAYS_MIN
} from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "../environments/environment-storage.js";
import { deleteTaskHistoryArchive } from "./task-history.js";

const TERMINAL_TASK_STATUSES = ["succeeded", "failed", "cancelled"] as const;
const ACTIVE_TASK_STATUSES = ["queued", "starting", "running"] as const;
const INCOGNITO_TASK_RETENTION_DAYS = 1;
const DEFAULT_TASK_CLEANUP_BATCH_SIZE = 120;
const MAX_TASK_CLEANUP_BATCH_SIZE = 500;

export interface TaskCleanupCandidateResult {
  taskIds: string[];
  taskRootPaths: string[];
  workspacePaths: string[];
  archiveKeys: string[];
}

export interface TaskDeleteResult {
  deletedTaskCount: number;
  deletedPathCount: number;
  skippedPathCount: number;
  pathErrorCount: number;
}

export class TaskDeletionConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super("Task is still active. Cancel it before deleting permanently.");
    this.name = "TaskDeletionConflictError";
  }
}

export interface EnvironmentTaskCleanupTarget {
  environmentId: string;
  workspaceId: string;
  rootPath: string;
}

export interface RunEnvironmentTaskCleanupInput extends EnvironmentTaskCleanupTarget {
  expirationDays: number;
  limit?: number;
}

export interface EnvironmentTaskCleanupResult {
  expirationDays: number;
  cutoffIso: string;
  deletedTaskCount: number;
  deletedPathCount: number;
  skippedPathCount: number;
  pathErrorCount: number;
  reachedBatchLimit: boolean;
}

function emptyTaskCleanupCandidates(): TaskCleanupCandidateResult {
  return { taskIds: [], taskRootPaths: [], workspacePaths: [], archiveKeys: [] };
}

export async function deleteTaskTreesInTx(
  client: PoolClient,
  rootTaskIds: string[]
): Promise<TaskCleanupCandidateResult> {
  const normalizedRootTaskIds = Array.from(new Set(rootTaskIds.filter((taskId) => taskId.trim().length > 0)));
  if (normalizedRootTaskIds.length === 0) {
    return emptyTaskCleanupCandidates();
  }

  const candidatesRes = await client.query<{
    id: string;
    environment_id: string;
    task_root_path: string;
    task_history_archive_key: string | null;
  }>(
    `WITH RECURSIVE selected_tasks AS (
       SELECT t.id,
              t.environment_id,
              t.task_root_path,
              t.task_history_archive_key
         FROM tasks t
        WHERE t.id = ANY($1::uuid[])
       UNION
       SELECT child.id,
              child.environment_id,
              child.task_root_path,
              child.task_history_archive_key
         FROM tasks child
         JOIN selected_tasks parent
           ON child.parent_task_id = parent.id
           OR child.workflow_parent_task_id = parent.id
        WHERE child.environment_id = parent.environment_id
     )
     SELECT DISTINCT id, task_root_path, task_history_archive_key
       FROM selected_tasks`,
    [normalizedRootTaskIds]
  );
  const selectedTaskIds = candidatesRes.rows.map((row) => row.id);
  if (selectedTaskIds.length === 0) {
    return emptyTaskCleanupCandidates();
  }

  await client.query(
    `SELECT id
       FROM tasks
      WHERE id = ANY($1::uuid[])
      FOR UPDATE`,
    [selectedTaskIds]
  );

  const activeRes = await client.query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE id = ANY($1::uuid[])
        AND status = ANY($2::text[])
     UNION ALL
     SELECT task_id AS id
       FROM task_runs
      WHERE task_id = ANY($1::uuid[])
        AND ended_at IS NULL
      LIMIT 1`,
    [selectedTaskIds, ACTIVE_TASK_STATUSES]
  );
  if ((activeRes.rowCount ?? 0) > 0) {
    throw new TaskDeletionConflictError();
  }

  const workspacePathsRes = await client.query<{ fs_path: string }>(
    `SELECT fs_path
       FROM task_workspaces
      WHERE task_id = ANY($1::uuid[])`,
    [selectedTaskIds]
  );

  await client.query(
    `DELETE FROM tasks
      WHERE id = ANY($1::uuid[])`,
    [selectedTaskIds]
  );

  return {
    taskIds: selectedTaskIds,
    taskRootPaths: candidatesRes.rows.map((row) => row.task_root_path),
    workspacePaths: workspacePathsRes.rows.map((row) => row.fs_path),
    archiveKeys: candidatesRes.rows.flatMap((row) => row.task_history_archive_key ? [row.task_history_archive_key] : [])
  };
}

function normalizeCleanupBatchLimit(rawLimit?: number): number {
  const candidate = typeof rawLimit === "number" && Number.isFinite(rawLimit)
    ? Math.floor(rawLimit)
    : DEFAULT_TASK_CLEANUP_BATCH_SIZE;

  if (candidate < 1) {
    return 1;
  }

  if (candidate > MAX_TASK_CLEANUP_BATCH_SIZE) {
    return MAX_TASK_CLEANUP_BATCH_SIZE;
  }

  return candidate;
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
  taskRootPaths: string[];
  workspacePaths: string[];
}): Promise<{
  deletedPathCount: number;
  skippedPathCount: number;
  pathErrorCount: number;
}> {
  const envRoot = path.resolve(input.envRoot);
  const taskRunsRoot = path.resolve(envRoot, ".meowbert", "task-runs");
  const candidatePaths = new Set<string>();

  for (const taskId of input.taskIds) {
    candidatePaths.add(path.resolve(taskRunsRoot, taskId));
  }

  for (const taskRootPath of input.taskRootPaths) {
    const trimmedRootPath = taskRootPath.trim();
    if (!trimmedRootPath) {
      continue;
    }
    candidatePaths.add(path.resolve(envRoot, trimmedRootPath));
  }

  for (const rawPath of input.workspacePaths) {
    const trimmed = rawPath.trim();
    if (!trimmed) {
      continue;
    }
    candidatePaths.add(normalizeWorkspacePath(trimmed));
  }

  let deletedPathCount = 0;
  let skippedPathCount = 0;
  let pathErrorCount = 0;

  for (const candidatePath of candidatePaths) {
    if (candidatePath === taskRunsRoot || !isWithinPath(taskRunsRoot, candidatePath)) {
      skippedPathCount += 1;
      continue;
    }

    try {
      await fsPromises.rm(candidatePath, { recursive: true, force: true });
      deletedPathCount += 1;
    } catch {
      pathErrorCount += 1;
    }
  }

  return {
    deletedPathCount,
    skippedPathCount,
    pathErrorCount
  };
}

async function removeTaskArchiveFiles(archiveKeys: string[]): Promise<{
  deletedPathCount: number;
  pathErrorCount: number;
}> {
  const normalizedArchiveKeys = Array.from(
    new Set(
      archiveKeys
        .map((archiveKey) => archiveKey.trim())
        .filter((archiveKey) => archiveKey.length > 0)
    )
  );

  let deletedPathCount = 0;
  let pathErrorCount = 0;

  for (const archiveKey of normalizedArchiveKeys) {
    try {
      await deleteTaskHistoryArchive(archiveKey);
      deletedPathCount += 1;
    } catch {
      pathErrorCount += 1;
    }
  }

  return {
    deletedPathCount,
    pathErrorCount
  };
}

async function deleteOldTaskRows(input: {
  environmentId: string;
  cutoffIso: string;
  limit: number;
}): Promise<TaskCleanupCandidateResult> {
  return withTransaction(async (client) => {
    const candidatesRes = await client.query<{ id: string; task_root_path: string; task_history_archive_key: string | null }>(
      `SELECT t.id,
              t.task_root_path,
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

    return deleteTaskTreesInTx(client, candidatesRes.rows.map((row) => row.id));
  });
}

async function deleteExpiredIncognitoTaskRows(input: {
  environmentId: string;
  limit: number;
}): Promise<TaskCleanupCandidateResult> {
  const cutoffIso = computeCutoffIso(INCOGNITO_TASK_RETENTION_DAYS);
  const candidatesRes = await query<{ id: string }>(
    `SELECT t.id
       FROM tasks t
      WHERE t.environment_id = $1
        AND t.is_incognito = true
        AND t.created_at < $2::timestamptz
        AND t.status <> ALL($3::text[])
      ORDER BY t.created_at ASC, t.id ASC
      LIMIT $4`,
    [input.environmentId, cutoffIso, ACTIVE_TASK_STATUSES, input.limit]
  );

  return deleteTaskRowsByIds({
    environmentId: input.environmentId,
    taskIds: candidatesRes.rows.map((row) => row.id)
  });
}

async function deleteTaskRowsByIds(input: {
  environmentId: string;
  taskIds: string[];
}): Promise<TaskCleanupCandidateResult> {
  const taskIds = Array.from(new Set(input.taskIds.filter((taskId) => taskId.trim().length > 0)));
  if (taskIds.length === 0) {
    return { taskIds: [], taskRootPaths: [], workspacePaths: [], archiveKeys: [] };
  }

  return withTransaction(async (client) => {
    const candidateRes = await client.query<{ id: string }>(
      `SELECT id
         FROM tasks
        WHERE environment_id = $1
          AND id = ANY($2::uuid[])`,
      [input.environmentId, taskIds]
    );
    return deleteTaskTreesInTx(client, candidateRes.rows.map((row) => row.id));
  });
}

async function deleteTrashedTaskRowsBatch(input: {
  environmentId: string;
  limit: number;
}): Promise<TaskCleanupCandidateResult> {
  return withTransaction(async (client) => {
    const candidatesRes = await client.query<{ id: string; task_root_path: string; task_history_archive_key: string | null }>(
      `SELECT t.id,
              t.task_root_path,
              t.task_history_archive_key
         FROM tasks t
        WHERE t.environment_id = $1
          AND t.trashed_at IS NOT NULL
          AND t.status <> ALL($2::text[])
        ORDER BY COALESCE(t.trashed_at, t.updated_at, t.created_at) ASC,
                 t.id ASC
        LIMIT $3
        FOR UPDATE OF t SKIP LOCKED`,
      [input.environmentId, ACTIVE_TASK_STATUSES, input.limit]
    );

    return deleteTaskTreesInTx(client, candidatesRes.rows.map((row) => row.id));
  });
}

export async function finalizeDeletedTasks(input: {
  environmentId: string;
  workspaceId: string;
  rootPath: string;
  deleted: TaskCleanupCandidateResult;
}): Promise<TaskDeleteResult> {
  if (input.deleted.taskIds.length === 0) {
    return {
      deletedTaskCount: 0,
      deletedPathCount: 0,
      skippedPathCount: 0,
      pathErrorCount: 0
    };
  }

  const envRoot = await ensureEnvironmentStorageRoot({
    id: input.environmentId,
    workspace_id: input.workspaceId,
    root_path: input.rootPath
  });

  const pathCleanup = await removeTaskWorkspacePaths({
    envRoot,
    taskIds: input.deleted.taskIds,
    taskRootPaths: input.deleted.taskRootPaths,
    workspacePaths: input.deleted.workspacePaths
  });
  const archiveCleanup = await removeTaskArchiveFiles(input.deleted.archiveKeys);

  return {
    deletedTaskCount: input.deleted.taskIds.length,
    deletedPathCount: pathCleanup.deletedPathCount + archiveCleanup.deletedPathCount,
    skippedPathCount: pathCleanup.skippedPathCount,
    pathErrorCount: pathCleanup.pathErrorCount + archiveCleanup.pathErrorCount
  };
}

export async function permanentlyDeleteTasks(input: {
  environmentId: string;
  workspaceId: string;
  rootPath: string;
  taskIds: string[];
}): Promise<TaskDeleteResult> {
  const deleted = await deleteTaskRowsByIds({
    environmentId: input.environmentId,
    taskIds: input.taskIds
  });

  return finalizeDeletedTasks({
    environmentId: input.environmentId,
    workspaceId: input.workspaceId,
    rootPath: input.rootPath,
    deleted
  });
}

export async function emptyEnvironmentTrash(input: {
  environmentId: string;
  workspaceId: string;
  rootPath: string;
}): Promise<TaskDeleteResult> {
  const limit = MAX_TASK_CLEANUP_BATCH_SIZE;
  let deletedTaskCount = 0;
  let deletedPathCount = 0;
  let skippedPathCount = 0;
  let pathErrorCount = 0;

  while (true) {
    const deleted = await deleteTrashedTaskRowsBatch({
      environmentId: input.environmentId,
      limit
    });

    if (deleted.taskIds.length === 0) {
      break;
    }

    const batchResult = await finalizeDeletedTasks({
      environmentId: input.environmentId,
      workspaceId: input.workspaceId,
      rootPath: input.rootPath,
      deleted
    });

    deletedTaskCount += batchResult.deletedTaskCount;
    deletedPathCount += batchResult.deletedPathCount;
    skippedPathCount += batchResult.skippedPathCount;
    pathErrorCount += batchResult.pathErrorCount;

    if (deleted.taskIds.length < limit) {
      break;
    }
  }

  return {
    deletedTaskCount,
    deletedPathCount,
    skippedPathCount,
    pathErrorCount
  };
}

export function resolveTaskCleanupExpirationDays(rawPayload: unknown): number | null {
  return parseTaskCleanupSettings(rawPayload).expirationDays;
}

export function isValidTaskCleanupExpirationDays(value: number): boolean {
  return value >= TASK_CLEANUP_EXPIRATION_DAYS_MIN && value <= TASK_CLEANUP_EXPIRATION_DAYS_MAX;
}

export async function runEnvironmentTaskCleanup(input: RunEnvironmentTaskCleanupInput): Promise<EnvironmentTaskCleanupResult> {
  if (!isValidTaskCleanupExpirationDays(input.expirationDays)) {
    throw new Error(
      `expirationDays must be between ${TASK_CLEANUP_EXPIRATION_DAYS_MIN} and ${TASK_CLEANUP_EXPIRATION_DAYS_MAX}`
    );
  }

  const limit = normalizeCleanupBatchLimit(input.limit);
  const cutoffIso = computeCutoffIso(input.expirationDays);
  const envRoot = await ensureEnvironmentStorageRoot({
    id: input.environmentId,
    workspace_id: input.workspaceId,
    root_path: input.rootPath
  });

  const deleted = await deleteOldTaskRows({
    environmentId: input.environmentId,
    cutoffIso,
    limit
  });
  const deletedIncognito = await deleteExpiredIncognitoTaskRows({
    environmentId: input.environmentId,
    limit
  });
  const combinedDeleted: TaskCleanupCandidateResult = {
    taskIds: [...deleted.taskIds, ...deletedIncognito.taskIds],
    taskRootPaths: [...deleted.taskRootPaths, ...deletedIncognito.taskRootPaths],
    workspacePaths: [...deleted.workspacePaths, ...deletedIncognito.workspacePaths],
    archiveKeys: [...deleted.archiveKeys, ...deletedIncognito.archiveKeys]
  };

  const pathCleanup = await removeTaskWorkspacePaths({
    envRoot,
    taskIds: combinedDeleted.taskIds,
    taskRootPaths: combinedDeleted.taskRootPaths,
    workspacePaths: combinedDeleted.workspacePaths
  });
  const archiveCleanup = await removeTaskArchiveFiles(combinedDeleted.archiveKeys);

  return {
    expirationDays: input.expirationDays,
    cutoffIso,
    deletedTaskCount: combinedDeleted.taskIds.length,
    deletedPathCount: pathCleanup.deletedPathCount + archiveCleanup.deletedPathCount,
    skippedPathCount: pathCleanup.skippedPathCount,
    pathErrorCount: pathCleanup.pathErrorCount + archiveCleanup.pathErrorCount,
    reachedBatchLimit: combinedDeleted.taskIds.length >= limit
  };
}
