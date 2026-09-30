import fsPromises from "node:fs/promises";
import { resolveRealPathWithinRoot } from "@meowbert/shared/server-security";
import { query } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "../environments/environment-storage.js";

interface TaskInlineFileRow {
  environment_id: string;
  workspace_id: string;
  task_root_path: string;
  environment_root_path: string;
}

async function resolveTaskInlineFileRow(
  sql: string,
  value: string,
  notFoundMessage: string,
  requestedPath: string
): Promise<{
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
}> {
  const result = await query<TaskInlineFileRow>(sql, [value]);
  if ((result.rowCount ?? 0) === 0) {
    throw new Error(notFoundMessage);
  }

  const environmentRoot = await ensureEnvironmentStorageRoot({
    id: result.rows[0].environment_id,
    workspace_id: result.rows[0].workspace_id,
    root_path: result.rows[0].environment_root_path
  });
  const taskRoot = await resolveRealPathWithinRoot(environmentRoot, result.rows[0].task_root_path);
  const file = await resolveRealPathWithinRoot(taskRoot.absolutePath, requestedPath);
  const fileStats = await fsPromises.lstat(file.absolutePath).catch(() => null);
  if (!fileStats?.isFile()) {
    throw new Error("File not found");
  }

  return {
    absolutePath: file.absolutePath,
    relativePath: file.relativePath,
    sizeBytes: fileStats.size
  };
}

export async function resolveTaskInlineFile(taskId: string, requestedPath: string): Promise<{
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
}> {
  return resolveTaskInlineFileRow(
    `SELECT t.task_root_path,
            e.id AS environment_id,
            e.workspace_id,
            e.root_path AS environment_root_path
       FROM tasks t
       JOIN environments e
         ON e.id = t.environment_id
      WHERE t.id = $1`,
    taskId,
    "Task not found",
    requestedPath
  );
}

export async function resolvePublicTaskInlineFile(shareId: string, requestedPath: string): Promise<{
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
}> {
  return resolveTaskInlineFileRow(
    `SELECT t.task_root_path,
            e.id AS environment_id,
            e.workspace_id,
            e.root_path AS environment_root_path
       FROM tasks t
       JOIN environments e
         ON e.id = t.environment_id
      WHERE t.public_share_id = $1`,
    shareId,
    "Shared task not found",
    requestedPath
  );
}
