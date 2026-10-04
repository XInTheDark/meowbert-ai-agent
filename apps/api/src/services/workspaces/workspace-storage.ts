import { resolveCanonicalStorageRoot } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { storageBackendRegistry } from "../storage/backend-registry.js";
import { ensureWorkspaceLocalXfsProjectQuota } from "../storage/local-xfs-project-quotas.js";

interface WorkspaceStorageInput {
  id: string;
  root_path: string;
  storage_backend_id?: string | null;
}

async function persistWorkspaceRoot(workspaceId: string, rootPath: string): Promise<void> {
  await query(
    `UPDATE workspaces
        SET root_path = $2,
            updated_at = now()
      WHERE id = $1`,
    [workspaceId, rootPath]
  );
}

export async function resolveWorkspaceBackendId(workspaceId: string, providedBackendId?: string | null): Promise<string> {
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

export async function resolveManagedWorkspaceStorageRoot(input: {
  workspaceId: string;
  storageBackendId: string;
}): Promise<string> {
  await storageBackendRegistry.ensureBackendReady(input.storageBackendId);
  return storageBackendRegistry.resolveManagedWorkspaceRoot(input.storageBackendId, input.workspaceId);
}

export async function ensureWorkspaceStorageRoot(input: WorkspaceStorageInput): Promise<string> {
  const storageBackendId = await resolveWorkspaceBackendId(input.id, input.storage_backend_id);
  const workspaceRoot = await resolveCanonicalStorageRoot({
    configuredRoot: input.root_path,
    managedRoot: await resolveManagedWorkspaceStorageRoot({
      workspaceId: input.id,
      storageBackendId
    }),
    persistRoot: async (rootPath) => persistWorkspaceRoot(input.id, rootPath)
  });

  await ensureWorkspaceLocalXfsProjectQuota({
    workspaceId: input.id,
    storageBackendId,
    workspaceRoot
  });

  return workspaceRoot;
}
