import { normalizeWorkspaceFileHost, workspaceFileFeatures, assertServerWorkspaceFiles, type WorkspaceFileHost } from "@meowbert/shared";
import { query } from "../../lib/db.js";

export async function loadWorkspaceFileHost(workspaceId: string): Promise<WorkspaceFileHost> {
  const result = await query<{ file_host: unknown; storage_backend_id: string }>(
    "SELECT file_host, storage_backend_id FROM workspaces WHERE id = $1", [workspaceId]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Workspace not found");
  return normalizeWorkspaceFileHost(row.file_host, row.storage_backend_id);
}

export async function assertWorkspaceFilesOnServer(workspaceId: string): Promise<void> {
  assertServerWorkspaceFiles(workspaceId, await loadWorkspaceFileHost(workspaceId));
}

export async function loadWorkspaceFileFeatures(workspaceId: string) {
  return workspaceFileFeatures(await loadWorkspaceFileHost(workspaceId));
}

export async function requireWorkspaceFileFeature(workspaceId: string, feature: keyof ReturnType<typeof workspaceFileFeatures>): Promise<void> {
  if (!(await loadWorkspaceFileFeatures(workspaceId))[feature]) {
    throw Object.assign(new Error("This feature is unavailable for a device-hosted workspace."), { statusCode: 409, code: "DEVICE_WORKSPACE_FEATURE" });
  }
}
