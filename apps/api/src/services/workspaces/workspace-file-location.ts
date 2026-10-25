import { normalizeWorkspaceFileHost, type WorkspaceFileLocation } from "@meowbert/shared";
import { query } from "../../lib/db.js";

/** Metadata only. Never resolves a root or reads a workspace file. */
export async function loadWorkspaceFileLocation(userId: string, scope: { workspaceId?: string; projectId?: string; taskId?: string }): Promise<WorkspaceFileLocation> {
  const result = await query<{
    id: string; file_host: unknown; storage_backend_id: string; device_name: string | null;
    project_id: string | null; project_name: string | null; task_root_path: string | null; memory_enabled: boolean;
  }>(
    `SELECT w.id, w.file_host, w.storage_backend_id, dv.name AS device_name,
       e.id AS project_id, e.name AS project_name, t.task_root_path, COALESCE(ws.memory_enabled, true) AS memory_enabled
       FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $1
       LEFT JOIN tasks t ON t.id = $4::uuid AND t.workspace_id = w.id
       LEFT JOIN environments e ON e.workspace_id = w.id AND (e.id = $3::uuid OR e.id = t.environment_id)
       LEFT JOIN devices dv ON dv.id::text = w.file_host->>'deviceId'
       LEFT JOIN workspace_settings ws ON ws.workspace_id = w.id
       WHERE ($2::uuid IS NOT NULL AND w.id = $2::uuid)
          OR ($3::uuid IS NOT NULL AND e.id = $3::uuid)
          OR ($4::uuid IS NOT NULL AND t.id = $4::uuid)
       LIMIT 1`,
    [userId, scope.workspaceId ?? null, scope.projectId ?? null, scope.taskId ?? null]
  );
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error("Workspace files not found"), { statusCode: 404 });
  return { workspaceId: row.id, fileHost: normalizeWorkspaceFileHost(row.file_host, row.storage_backend_id),
    deviceName: row.device_name, projectId: row.project_id, projectName: row.project_name, taskRootPath: row.task_root_path, memoryEnabled: row.memory_enabled };
}
