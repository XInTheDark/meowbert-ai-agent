import { resolveCanonicalStorageRoot } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { storageBackendRegistry } from "../storage/backend-registry.js";

interface EnvironmentStorageInput {
  id: string;
  workspace_id: string;
  root_path: string;
  workspace_storage_backend_id?: string | null;
}

async function persistEnvironmentRoot(environmentId: string, rootPath: string): Promise<void> {
  await query(
    `UPDATE environments
        SET root_path = $2,
            updated_at = now()
      WHERE id = $1`,
    [environmentId, rootPath]
  );
}

async function resolveWorkspaceBackendId(workspaceId: string, providedBackendId?: string | null): Promise<string> {
  const trimmedProvided = providedBackendId?.trim();
  if (trimmedProvided) {
    return trimmedProvided;
  }

  const workspaceRes = await query<{ storage_backend_id: string }>(
    `SELECT storage_backend_id
       FROM workspaces
      WHERE id = $1`,
    [workspaceId]
  );

  if ((workspaceRes.rowCount ?? 0) === 0) {
    throw new Error("Workspace not found");
  }

  return workspaceRes.rows[0]?.storage_backend_id?.trim() || storageBackendRegistry.getConfiguredDefaultBackendId();
}

export async function resolveManagedEnvironmentStorageRoot(input: {
  workspaceId: string;
  environmentId: string;
  storageBackendId: string;
}): Promise<string> {
  await storageBackendRegistry.ensureBackendReady(input.storageBackendId);
  return storageBackendRegistry.resolveManagedEnvironmentRoot(
    input.storageBackendId,
    input.workspaceId,
    input.environmentId
  );
}

export async function ensureEnvironmentStorageRoot(input: EnvironmentStorageInput): Promise<string> {
  const storageBackendId = await resolveWorkspaceBackendId(input.workspace_id, input.workspace_storage_backend_id);
  return resolveCanonicalStorageRoot({
    configuredRoot: input.root_path,
    managedRoot: await resolveManagedEnvironmentStorageRoot({
      workspaceId: input.workspace_id,
      environmentId: input.id,
      storageBackendId
    }),
    persistRoot: async (rootPath) => persistEnvironmentRoot(input.id, rootPath)
  });
}
