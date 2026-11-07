import { assertFolderInProject, ProjectMapError, type ProjectMapDb } from "./project-map-db.js";
import { PROJECT_BRIEF_MAX_CHARS, PROJECT_FOLDER_NOTE_MAX_CHARS, PROJECT_MAP_NAME_MAX_CHARS } from "./project-map.js";

function requireName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ProjectMapError("Folder name cannot be empty.");
  if (trimmed.length > PROJECT_MAP_NAME_MAX_CHARS) throw new ProjectMapError(`Folder name is longer than ${PROJECT_MAP_NAME_MAX_CHARS} characters.`);
  return trimmed;
}

function requireNoteLength(markdown: string, max: number, label: string): string {
  if (markdown.length > max) throw new ProjectMapError(`${label} is longer than ${max} characters. Keep it shorter or move detail into a subfolder's note.`);
  return markdown;
}

export async function createProjectFolder(db: ProjectMapDb, input: {
  workspaceId: string;
  environmentId: string;
  parentFolderId: string | null;
  name: string;
  note: string;
}): Promise<string> {
  await assertFolderInProject(db, input.environmentId, input.parentFolderId);
  const result = await db.query<{ id: string }>(
    `INSERT INTO task_folders (workspace_id, environment_id, parent_folder_id, name, note_markdown, sort_order)
     VALUES ($1, $2, $3, $4, $5, (
       SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task_folders
        WHERE environment_id = $2 AND parent_folder_id IS NOT DISTINCT FROM $3::uuid
     ))
     RETURNING id`,
    [input.workspaceId, input.environmentId, input.parentFolderId, requireName(input.name),
      requireNoteLength(input.note, PROJECT_FOLDER_NOTE_MAX_CHARS, "Folder note")]
  );
  return result.rows[0].id;
}

export async function renameProjectFolder(db: ProjectMapDb, environmentId: string, folderId: string, name: string): Promise<void> {
  await assertFolderInProject(db, environmentId, folderId);
  await db.query("UPDATE task_folders SET name = $2, updated_at = now() WHERE id = $1", [folderId, requireName(name)]);
}

export async function setProjectFolderNote(db: ProjectMapDb, environmentId: string, folderId: string, markdown: string): Promise<void> {
  await assertFolderInProject(db, environmentId, folderId);
  await db.query(
    "UPDATE task_folders SET note_markdown = $2, updated_at = now() WHERE id = $1",
    [folderId, requireNoteLength(markdown, PROJECT_FOLDER_NOTE_MAX_CHARS, "Folder note")]
  );
}

export async function setProjectBrief(db: ProjectMapDb, environmentId: string, markdown: string): Promise<void> {
  await db.query(
    `INSERT INTO project_briefs (environment_id, markdown) VALUES ($1, $2)
     ON CONFLICT (environment_id) DO UPDATE SET markdown = EXCLUDED.markdown, updated_at = now()`,
    [environmentId, requireNoteLength(markdown, PROJECT_BRIEF_MAX_CHARS, "Project brief")]
  );
}

// Nothing inside a deleted folder is lost: its subfolders, tasks and cards move up to its parent.
// The caller runs this in a transaction.
export async function deleteProjectFolder(db: ProjectMapDb, environmentId: string, folderId: string): Promise<void> {
  const folder = await db.query<{ parent_folder_id: string | null }>(
    "SELECT parent_folder_id FROM task_folders WHERE id = $1 AND environment_id = $2 FOR UPDATE",
    [folderId, environmentId]
  );
  if (!folder.rows[0]) throw new ProjectMapError(`Folder not found in this project: ${folderId}`, 404);
  const parentId = folder.rows[0].parent_folder_id;
  await db.query("UPDATE task_folders SET parent_folder_id = $2, updated_at = now() WHERE parent_folder_id = $1", [folderId, parentId]);
  await db.query("UPDATE tasks SET folder_id = $2, updated_at = now() WHERE folder_id = $1", [folderId, parentId]);
  await db.query("UPDATE project_map_cards SET folder_id = $2, updated_at = now() WHERE folder_id = $1", [folderId, parentId]);
  await db.query("DELETE FROM task_folders WHERE id = $1", [folderId]);
}
