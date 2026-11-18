import { createHash } from "node:crypto";
import { ProjectMapError, type ProjectMapDb } from "@meowbert/shared";

// Identifies the exact note the Master read, so saving over a newer version can be refused.
// An empty note has no revision.
export function noteRevision(markdown: string): string | null {
  if (!markdown.trim()) return null;
  return createHash("sha256").update(markdown).digest("hex").slice(0, 12);
}

async function lockCurrentNote(db: ProjectMapDb, environmentId: string, folderId: string | null): Promise<string> {
  if (folderId) {
    const folder = await db.query<{ note_markdown: string }>(
      "SELECT note_markdown FROM task_folders WHERE id = $1 AND environment_id = $2 FOR UPDATE",
      [folderId, environmentId]
    );
    if (!folder.rows[0]) throw new ProjectMapError(`Folder not found in this project: ${folderId}`, 404);
    return folder.rows[0].note_markdown;
  }
  // A brief may not have a row yet, and only an existing row can be locked.
  await db.query("INSERT INTO project_briefs (environment_id, markdown) VALUES ($1, '') ON CONFLICT (environment_id) DO NOTHING", [environmentId]);
  const brief = await db.query<{ markdown: string }>("SELECT markdown FROM project_briefs WHERE environment_id = $1 FOR UPDATE", [environmentId]);
  return brief.rows[0].markdown;
}

// The caller runs this in the transaction that saves the note, so the lock covers the write.
export async function assertNoteUnchanged(db: ProjectMapDb, environmentId: string, folderId: string | null, revision: string | null): Promise<void> {
  if (noteRevision(await lockCurrentNote(db, environmentId, folderId)) !== revision) {
    throw new ProjectMapError("This note has changed since you read it. Read it again with view_project_map and keep the new content in your update.", 409);
  }
}
