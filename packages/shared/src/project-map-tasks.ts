import { ProjectMapError, type ProjectMapDb } from "./project-map-db.js";
import { PROJECT_MAP_TASK_TITLE_MAX_CHARS } from "./project-map.js";
import { PROJECT_MAP_TASK_FILTER } from "./project-map-store.js";

function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new ProjectMapError("Task title cannot be empty.");
  if (trimmed.length > PROJECT_MAP_TASK_TITLE_MAX_CHARS) throw new ProjectMapError(`Task title is longer than ${PROJECT_MAP_TASK_TITLE_MAX_CHARS} characters.`);
  return trimmed;
}

export async function renameProjectMapTask(db: ProjectMapDb, environmentId: string, taskId: string, title: string): Promise<void> {
  const result = await db.query(
    `UPDATE tasks t SET title = $3, updated_at = now() WHERE ${PROJECT_MAP_TASK_FILTER} AND t.id = $2`,
    [environmentId, taskId, requireTitle(title)]
  );
  if (!result.rowCount) throw new ProjectMapError(`Task not found on this project's map: ${taskId}`, 404);
}

const ACTIVE_TASK_STATUSES = new Set(["queued", "starting", "running"]);

// Trashed tasks keep their folder, so restoring one puts it back where it was. The caller runs this
// in a transaction so the row locks hold until every task has been checked and trashed.
export async function trashProjectMapTasks(db: ProjectMapDb, environmentId: string, taskIds: string[]): Promise<void> {
  const unique = [...new Set(taskIds)];
  const found = await db.query<{ id: string; status: string }>(
    `SELECT t.id, t.status FROM tasks t WHERE ${PROJECT_MAP_TASK_FILTER} AND t.id = ANY($2::uuid[]) FOR UPDATE`,
    [environmentId, unique]
  );
  const known = new Set(found.rows.map((row) => row.id));
  const missing = unique.filter((id) => !known.has(id));
  if (missing.length) throw new ProjectMapError(`Task not found on this project's map: ${missing.join(", ")}`, 404);
  const active = found.rows.filter((row) => ACTIVE_TASK_STATUSES.has(row.status)).map((row) => row.id);
  if (active.length) throw new ProjectMapError(`Cancel these tasks and wait for them to stop before trashing them: ${active.join(", ")}`, 409);
  await db.query("UPDATE tasks SET trashed_at = now(), updated_at = now() WHERE id = ANY($1::uuid[])", [unique]);
}
