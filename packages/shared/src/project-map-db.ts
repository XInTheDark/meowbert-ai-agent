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
