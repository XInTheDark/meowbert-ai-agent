import {
  archiveTaskHistory as archiveSharedTaskHistory,
  deleteTaskHistoryArchiveByKey,
  ensureTaskHistoryWarm as ensureSharedTaskHistoryWarm,
  resetStaleArchivingTasks
} from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { query, withTransaction } from "../../lib/db.js";
import { removeTasksScratch } from "./task-scratch.js";

const taskHistoryDeps = {
  archiveConfig: config.taskHistoryArchive,
  db: {
    query,
    withTransaction
  },
  logger: {
    info: (message: string) => console.info(message),
    warn: (message: string) => console.warn(message),
    error: (message: string) => console.error(message)
  }
} as const;

export async function ensureTaskHistoryWarm(taskId: string): Promise<void> {
  await ensureSharedTaskHistoryWarm(taskId, taskHistoryDeps);
}

export async function archiveTaskHistory(taskId: string) {
  const result = await archiveSharedTaskHistory(taskId, taskHistoryDeps);
  if (result.status === "archived") {
    await removeArchivedTaskScratch(taskId);
  }
  return result;
}

// Scratch is disposable and never archived; a restored task starts with an empty one.
async function removeArchivedTaskScratch(taskId: string): Promise<void> {
  const taskRes = await query<{ workspace_id: string }>("SELECT workspace_id FROM tasks WHERE id = $1", [taskId]);
  const workspaceId = taskRes.rows[0]?.workspace_id;
  if (workspaceId) {
    await removeTasksScratch(workspaceId, [taskId]);
  }
}

export async function resetStaleTaskHistoryArchiving(now?: Date): Promise<number> {
  return resetStaleArchivingTasks(taskHistoryDeps.db, now);
}

export async function deleteTaskHistoryArchive(archiveKey: string | null | undefined): Promise<void> {
  await deleteTaskHistoryArchiveByKey(config.taskHistoryArchive, archiveKey);
}
