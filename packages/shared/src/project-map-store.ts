import type { ProjectMapDb } from "./project-map-db.js";
import { PROJECT_MAP_TASK_LIMIT, type ProjectMap, type ProjectMapCard, type ProjectMapFolder, type ProjectMapTask } from "./project-map.js";

// Tasks that belong on the map: top-level, visible, and not in the trash. Subtasks, workflow
// lanes, incognito tasks and the Master itself stay off it.
export const PROJECT_MAP_TASK_FILTER = `t.environment_id = $1
  AND t.parent_task_id IS NULL
  AND t.workflow_parent_task_id IS NULL
  AND t.is_hidden = false
  AND t.is_incognito = false
  AND t.trashed_at IS NULL`;

async function loadBrief(db: ProjectMapDb, environmentId: string): Promise<string> {
  const result = await db.query<{ markdown: string }>("SELECT markdown FROM project_briefs WHERE environment_id = $1", [environmentId]);
  return result.rows[0]?.markdown ?? "";
}

async function loadFolders(db: ProjectMapDb, environmentId: string): Promise<ProjectMapFolder[]> {
  const result = await db.query<{ id: string; parent_folder_id: string | null; name: string; note_markdown: string; sort_order: number }>(
    `SELECT id, parent_folder_id, name, note_markdown, sort_order
       FROM task_folders
      WHERE environment_id = $1
      ORDER BY sort_order, created_at, id`,
    [environmentId]
  );
  return result.rows.map((row) => ({
    id: row.id, parentFolderId: row.parent_folder_id, name: row.name, note: row.note_markdown, sortOrder: Number(row.sort_order)
  }));
}

async function loadCards(db: ProjectMapDb, environmentId: string): Promise<ProjectMapCard[]> {
  const result = await db.query<{ id: string; folder_id: string | null; title: string; body: string; state: ProjectMapCard["state"]; sort_order: number }>(
    `SELECT id, folder_id, title, body, state, sort_order
       FROM project_map_cards
      WHERE environment_id = $1
      ORDER BY sort_order, created_at, id`,
    [environmentId]
  );
  return result.rows.map((row) => ({
    id: row.id, folderId: row.folder_id, title: row.title, body: row.body, state: row.state, sortOrder: Number(row.sort_order)
  }));
}

async function loadTasks(db: ProjectMapDb, environmentId: string): Promise<{ tasks: ProjectMapTask[]; truncated: boolean }> {
  const result = await db.query<{ id: string; folder_id: string | null; title: string | null; status: ProjectMapTask["status"]; updated_at: Date | string }>(
    `SELECT t.id, t.folder_id, t.title, t.status, t.updated_at
       FROM tasks t
      WHERE ${PROJECT_MAP_TASK_FILTER}
      ORDER BY t.updated_at DESC, t.id
      LIMIT $2`,
    [environmentId, PROJECT_MAP_TASK_LIMIT + 1]
  );
  const rows = result.rows.slice(0, PROJECT_MAP_TASK_LIMIT);
  return {
    tasks: rows.map((row) => ({
      id: row.id, folderId: row.folder_id, title: row.title, status: row.status,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at)
    })),
    truncated: result.rows.length > PROJECT_MAP_TASK_LIMIT
  };
}

export async function loadProjectMap(db: ProjectMapDb, environmentId: string): Promise<ProjectMap> {
  const [brief, folders, cards, tasks] = await Promise.all([
    loadBrief(db, environmentId),
    loadFolders(db, environmentId),
    loadCards(db, environmentId),
    loadTasks(db, environmentId)
  ]);
  return { brief, folders, cards, tasks: tasks.tasks, tasksTruncated: tasks.truncated };
}
