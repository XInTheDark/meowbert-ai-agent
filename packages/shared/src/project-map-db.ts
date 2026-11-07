// The database surface the Project Map store needs. A pg Pool or PoolClient satisfies it, so the API
// and the worker share one implementation.
export interface ProjectMapDb {
  query<T extends object>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

// A request the map cannot apply, such as an unknown folder. The message is safe to show.
export class ProjectMapError extends Error {
  readonly exposeMessage = true;

  constructor(message: string, readonly statusCode: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "ProjectMapError";
  }
}

export async function assertFolderInProject(db: ProjectMapDb, environmentId: string, folderId: string | null): Promise<void> {
  if (!folderId) return;
  const result = await db.query("SELECT 1 FROM task_folders WHERE id = $1 AND environment_id = $2", [folderId, environmentId]);
  if (!result.rowCount) throw new ProjectMapError(`Folder not found in this project: ${folderId}`, 404);
}

// Call inside the mutation transaction, before reading ancestry. Every reparenting path
// takes the same project lock so the next cycle check sees the previous committed move.
export async function lockProjectMapHierarchy(db: ProjectMapDb, environmentId: string): Promise<void> {
  await db.query("SELECT id FROM environments WHERE id = $1 FOR NO KEY UPDATE", [environmentId]);
}
