import {
  deleteTaskHistoryArchiveByKey,
  ensureTaskHistoryWarm as ensureSharedTaskHistoryWarm,
  getTaskHistoryArchiveHealth
} from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { query, withTransaction } from "../../lib/db.js";

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

export async function deleteTaskHistoryArchive(archiveKey: string | null | undefined): Promise<void> {
  await deleteTaskHistoryArchiveByKey(config.taskHistoryArchive, archiveKey);
}

export async function getConfiguredTaskHistoryArchiveHealth() {
  return getTaskHistoryArchiveHealth(config.taskHistoryArchive);
}
