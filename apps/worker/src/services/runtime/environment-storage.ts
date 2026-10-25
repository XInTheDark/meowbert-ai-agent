import { resolveCanonicalStorageRoot, normalizeWorkspaceFileHost, assertServerWorkspaceFiles } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { storageBackendRegistry } from "../storage/backend-registry.js";

interface ResolveTaskEnvironmentRootInput {
  workspaceId: string;
  environmentId: string;
  rootPath: string;
  storageBackendId?: string | null;
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

  const workspaceRes = await query<{ storage_backend_id: string; file_host?: unknown }>(
    `SELECT storage_backend_id, file_host
       FROM workspaces
      WHERE id = $1`,
    [workspaceId]
  );

  if ((workspaceRes.rowCount ?? 0) === 0) {
    throw new Error("Workspace not found");
  }

  const row = workspaceRes.rows[0];
  assertServerWorkspaceFiles(workspaceId, normalizeWorkspaceFileHost(row.file_host, row.storage_backend_id));
  return providedBackendId?.trim() || row.storage_backend_id?.trim() || storageBackendRegistry.getConfiguredDefaultBackendId();
}

export async function resolveManagedTaskEnvironmentRoot(input: {
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

export async function resolveTaskEnvironmentRoot(input: ResolveTaskEnvironmentRootInput): Promise<string> {
  const storageBackendId = await resolveWorkspaceBackendId(input.workspaceId, input.storageBackendId);
  return resolveCanonicalStorageRoot({
    configuredRoot: input.rootPath,
    managedRoot: await resolveManagedTaskEnvironmentRoot({
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      storageBackendId
    }),
    persistRoot: async (rootPath) => persistEnvironmentRoot(input.environmentId, rootPath)
  });
}
