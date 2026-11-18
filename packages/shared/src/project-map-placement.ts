import { assertFolderInProject, lockProjectMapHierarchy, ProjectMapError, type ProjectMapDb } from "./project-map-db.js";
import { PROJECT_MAP_TASK_FILTER } from "./project-map-store.js";

export interface ProjectMapMoveResult {
  folderIds: string[];
  cardIds: string[];
  taskIds: string[];
}

async function findIds(db: ProjectMapDb, sql: string, environmentId: string, ids: string[]): Promise<string[]> {
  const result = await db.query<{ id: string }>(sql, [environmentId, ids]);
  return result.rows.map((row) => row.id);
}

// Sorts mixed ids into folders, cards and tasks; anything else in the list is an error.
async function classifyIds(db: ProjectMapDb, environmentId: string, ids: string[]): Promise<ProjectMapMoveResult> {
  const [folderIds, cardIds, taskIds] = await Promise.all([
    findIds(db, "SELECT id FROM task_folders WHERE environment_id = $1 AND id = ANY($2::uuid[])", environmentId, ids),
    findIds(db, "SELECT id FROM project_map_cards WHERE environment_id = $1 AND id = ANY($2::uuid[])", environmentId, ids),
    findIds(db, `SELECT t.id FROM tasks t WHERE ${PROJECT_MAP_TASK_FILTER} AND t.id = ANY($2::uuid[])`, environmentId, ids)
  ]);
  const known = new Set([...folderIds, ...cardIds, ...taskIds]);
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) throw new ProjectMapError(`Not found on this project's map: ${missing.join(", ")}`, 404);
  return { folderIds, cardIds, taskIds };
}

async function assertNoCycle(db: ProjectMapDb, folderIds: string[], targetFolderId: string | null): Promise<void> {
  if (!targetFolderId) return;
  if (folderIds.includes(targetFolderId)) throw new ProjectMapError("A folder cannot be moved into itself.", 409);
  const ancestors = await db.query<{ id: string }>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_folder_id FROM task_folders WHERE id = $1
       UNION
       SELECT f.id, f.parent_folder_id FROM task_folders f JOIN ancestors a ON f.id = a.parent_folder_id
     )
     SELECT id FROM ancestors WHERE id = ANY($2::uuid[]) LIMIT 1`,
    [targetFolderId, folderIds]
  );
  if (ancestors.rowCount) throw new ProjectMapError("A folder cannot be moved into its own subfolder.", 409);
}

// Moves folders, cards and tasks into one folder, or to the top of the map when targetFolderId is
// null. Moved items go to the end of the target, in the order given. The caller runs
// this in a transaction so the project lock covers validation and all updates.
export async function moveProjectMapItems(
  db: ProjectMapDb,
  environmentId: string,
  ids: string[],
  targetFolderId: string | null
): Promise<ProjectMapMoveResult> {
  await lockProjectMapHierarchy(db, environmentId);
  const unique = [...new Set(ids)];
  await assertFolderInProject(db, environmentId, targetFolderId);
  const moved = await classifyIds(db, environmentId, unique);
  await assertNoCycle(db, moved.folderIds, targetFolderId);
  const ordered = (subset: string[]) => unique.filter((id) => subset.includes(id));
  await db.query(
    `WITH base AS (SELECT COALESCE(MAX(sort_order), -1) AS value FROM task_folders WHERE environment_id = $1 AND parent_folder_id IS NOT DISTINCT FROM $3::uuid)
     UPDATE task_folders f SET parent_folder_id = $3, sort_order = base.value + input.ordinality, updated_at = now()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS input(id, ordinality), base
      WHERE f.id = input.id`,
    [environmentId, ordered(moved.folderIds), targetFolderId]
  );
  await db.query(
    `WITH base AS (SELECT COALESCE(MAX(sort_order), -1) AS value FROM project_map_cards WHERE environment_id = $1 AND folder_id IS NOT DISTINCT FROM $3::uuid)
     UPDATE project_map_cards c SET folder_id = $3, sort_order = base.value + input.ordinality, updated_at = now()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS input(id, ordinality), base
      WHERE c.id = input.id`,
    [environmentId, ordered(moved.cardIds), targetFolderId]
  );
  await db.query(
    `WITH base AS (SELECT COALESCE(MAX(folder_sort_order), -1) AS value FROM tasks WHERE environment_id = $1 AND folder_id IS NOT DISTINCT FROM $3::uuid)
     UPDATE tasks t SET folder_id = $3, folder_sort_order = base.value + input.ordinality, updated_at = now()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS input(id, ordinality), base
      WHERE t.id = input.id`,
    [environmentId, ordered(moved.taskIds), targetFolderId]
  );
  return moved;
}

const ORDER_COLUMNS = {
  folders: { table: "task_folders", parent: "parent_folder_id", order: "sort_order" },
  cards: { table: "project_map_cards", parent: "folder_id", order: "sort_order" },
  tasks: { table: "tasks", parent: "folder_id", order: "folder_sort_order" }
} as const;

async function placeFirst(
  db: ProjectMapDb,
  environmentId: string,
  { table, parent, order }: (typeof ORDER_COLUMNS)[keyof typeof ORDER_COLUMNS],
  ids: string[],
  folderId: string | null
): Promise<void> {
  if (!ids.length) return;
  const inFolder = await db.query(`SELECT id FROM ${table} WHERE id = ANY($1::uuid[]) AND ${parent} IS NOT DISTINCT FROM $2::uuid`, [ids, folderId]);
  if (inFolder.rows.length !== ids.length) throw new ProjectMapError("Items must already be directly in that folder to be reordered. Move them there first.", 409);
  // Leaves updated_at alone: a new order is not new activity on the item.
  await db.query(
    `WITH base AS (SELECT COALESCE(MIN(${order}), 0) - $4::int - 1 AS value FROM ${table} WHERE environment_id = $1 AND ${parent} IS NOT DISTINCT FROM $3::uuid)
     UPDATE ${table} item SET ${order} = base.value + input.ordinality
       FROM unnest($2::uuid[]) WITH ORDINALITY AS input(id, ordinality), base
      WHERE item.id = input.id`,
    [environmentId, ids, folderId, ids.length]
  );
}

// Puts the given items first among their siblings, in the order given. Folders, cards and tasks are
// ordered separately, and anything not listed keeps its order after them. The caller runs this in a
// transaction. Unfiled tasks always show newest first, so they have no order to set.
export async function reorderProjectMapItems(db: ProjectMapDb, environmentId: string, ids: string[], folderId: string | null): Promise<void> {
  await lockProjectMapHierarchy(db, environmentId);
  const unique = [...new Set(ids)];
  await assertFolderInProject(db, environmentId, folderId);
  const items = await classifyIds(db, environmentId, unique);
  if (!folderId && items.taskIds.length) throw new ProjectMapError("Unfiled tasks stay newest first. File them in a folder to set their order.");
  const ordered = (subset: string[]) => unique.filter((id) => subset.includes(id));
  await placeFirst(db, environmentId, ORDER_COLUMNS.folders, ordered(items.folderIds), folderId);
  await placeFirst(db, environmentId, ORDER_COLUMNS.cards, ordered(items.cardIds), folderId);
  await placeFirst(db, environmentId, ORDER_COLUMNS.tasks, ordered(items.taskIds), folderId);
}
