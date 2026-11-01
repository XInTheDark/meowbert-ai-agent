import { readTaskHistoryPayloads, type TaskHistoryPayloadReader } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { query } from "../../lib/db.js";

export const readTaskPayloads: TaskHistoryPayloadReader = (taskId, kind, rows, projection) =>
  !config.taskHistoryArchive?.enabled ? Promise.resolve(rows)
    : readTaskHistoryPayloads(taskId, kind, rows, { archiveConfig: config.taskHistoryArchive, db: { query } }, projection);
