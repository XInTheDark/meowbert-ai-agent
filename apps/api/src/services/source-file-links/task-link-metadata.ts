import path from "node:path";
import { query } from "../../lib/db.js";
import { listSourceFileLinksForEnvironmentPaths } from "./store.js";

// Folder search needs remote IDs and task scope, never workspace filesystem roots.
export async function getTaskLiveSyncLinkMetadata(input: { taskId: string; taskRelativePath: string }) {
  const result = await query<{ workspace_id: string; environment_id: string; task_root_path: string }>(
    "SELECT workspace_id, environment_id, task_root_path FROM tasks WHERE id = $1", [input.taskId]
  );
  const task = result.rows[0];
  if (!task) throw new Error("Task not found.");
  const value = input.taskRelativePath.trim().replace(/\\/g, "/");
  const normalized = path.posix.normalize(value);
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) throw new Error("Invalid live-folder path.");
  const taskPath = path.posix.join(task.task_root_path, normalized);
  const contextPath = normalized === "context" || normalized.startsWith("context/") ? normalized : null;
  const links = await listSourceFileLinksForEnvironmentPaths(task.environment_id, [taskPath, ...(contextPath ? [contextPath] : [])]);
  const link = links.find((entry) => entry.workspaceId === task.workspace_id &&
    ((entry.taskId === input.taskId && entry.localRelativePath === taskPath)
      || ((entry.taskId === null || entry.taskId === input.taskId) && entry.localRelativePath === contextPath)));
  if (!link) throw new Error("Live folder not found for this task.");
  return { link };
}
