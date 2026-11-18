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
