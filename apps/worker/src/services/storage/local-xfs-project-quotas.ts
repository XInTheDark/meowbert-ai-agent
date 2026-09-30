import path from "node:path";
import {
  XfsProjectQuotaManager,
  resolveWorkspaceStorageUnitRoot
} from "@meowbert/shared";
import type { LocalStorageBackendConfig } from "@meowbert/shared/storage-backends";
import { query, withTransaction } from "../../lib/db.js";
import { resolveWorkspaceStorageLimitBytes } from "../agent-db/user-resource-limits.js";
import { storageBackendRegistry } from "./backend-registry.js";

const xfsProjectQuotaManager = new XfsProjectQuotaManager();
const appliedQuotaCache = new Map<string, Promise<void>>();

function getLocalXfsProjectQuotaBackend(backendId: string): LocalStorageBackendConfig | null {
  const backend = storageBackendRegistry.getBackend(backendId);
  if (backend.type !== "local" || !backend.xfsProjectQuota) {
    return null;
  }
  return backend;
}

function assertQuotaMountContainsWorkspaceRoot(backend: LocalStorageBackendConfig): void {
  const mountPath = path.resolve(backend.xfsProjectQuota!.mountPath);
  const workspacesRoot = path.resolve(backend.workspacesRoot);
  const relative = path.relative(mountPath, workspacesRoot);

  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(
      `XFS quota mount path ${mountPath} must contain the local workspaces root ${workspacesRoot}.`
    );
  }
}

async function claimWorkspaceStorageProjectId(workspaceId: string, projectIdBase: number): Promise<number> {
  return withTransaction(async (client) => {
    const workspaceRes = await client.query<{ storage_project_id: number | null }>(
      `SELECT storage_project_id
         FROM workspaces
        WHERE id = $1
        FOR UPDATE`,
      [workspaceId]
    );

    if ((workspaceRes.rowCount ?? 0) === 0) {
      throw new Error("Workspace not found");
    }

    const existingProjectId = workspaceRes.rows[0]?.storage_project_id;
    if (typeof existingProjectId === "number" && Number.isFinite(existingProjectId) && existingProjectId > 0) {
      return existingProjectId;
    }

    await client.query("LOCK TABLE workspaces, storage_backend_cache_project_ids IN EXCLUSIVE MODE");
    const nextProjectIdRes = await client.query<{ next_project_id: number }>(
      `SELECT GREATEST(
          COALESCE((SELECT MAX(storage_project_id) FROM workspaces), 0) + 1,
          COALESCE((SELECT MAX(project_id) FROM storage_backend_cache_project_ids), 0) + 1,
          $1
        )::int AS next_project_id`,
      [projectIdBase]
    );
    const nextProjectId = Number(nextProjectIdRes.rows[0]?.next_project_id ?? projectIdBase);

    const updatedRes = await client.query<{ storage_project_id: number }>(
      `UPDATE workspaces
          SET storage_project_id = $2,
              updated_at = now()
        WHERE id = $1
        RETURNING storage_project_id`,
      [workspaceId, nextProjectId]
    );

    return Number(updatedRes.rows[0]?.storage_project_id ?? nextProjectId);
  });
}

export function listConfiguredLocalXfsProjectQuotaBackends(): LocalStorageBackendConfig[] {
  return storageBackendRegistry.listBackends().filter((backend): backend is LocalStorageBackendConfig =>
    backend.type === "local" && Boolean(backend.xfsProjectQuota)
  );
}

export async function inspectConfiguredLocalXfsProjectQuotaBackend(backendId: string): Promise<{
  ready: boolean;
  message: string;
}> {
  const backend = getLocalXfsProjectQuotaBackend(backendId);
  if (!backend?.xfsProjectQuota) {
    throw new Error(`Local backend ${backendId} does not have xfsProjectQuota configured.`);
  }

  const xfsProjectQuota = backend.xfsProjectQuota;
  assertQuotaMountContainsWorkspaceRoot(backend);

  const status = await xfsProjectQuotaManager.inspectMount({
    mountPath: xfsProjectQuota.mountPath,
    command: xfsProjectQuota.command
  });

  return {
    ready: status.ready,
    message: status.message
  };
}

export async function ensureWorkspaceLocalXfsProjectQuota(input: {
  workspaceId: string;
  storageBackendId: string;
  workspaceRoot: string;
}): Promise<void> {
  const backend = getLocalXfsProjectQuotaBackend(input.storageBackendId);
  if (!backend?.xfsProjectQuota) {
    return;
  }

  const xfsProjectQuota = backend.xfsProjectQuota;

  assertQuotaMountContainsWorkspaceRoot(backend);

  const limitBytes = await resolveWorkspaceStorageLimitBytes(input.workspaceId);
  if (limitBytes === null) {
    throw new Error("A workspace storage limit must be configured on the workspace owner or as the platform default to enforce xfs workspace quotas.");
  }

  const cacheKey = [
    input.storageBackendId,
    input.workspaceId,
    path.resolve(input.workspaceRoot),
    limitBytes
  ].join(":");
  const existing = appliedQuotaCache.get(cacheKey);
  if (existing) {
    await existing;
    return;
  }

  const pending = (async () => {
    const projectId = await claimWorkspaceStorageProjectId(input.workspaceId, xfsProjectQuota.projectIdBase);
    await xfsProjectQuotaManager.applyProjectQuota({
      mountPath: xfsProjectQuota.mountPath,
      storageUnitRoot: resolveWorkspaceStorageUnitRoot(input.workspaceRoot),
      projectId,
      quotaBytes: limitBytes,
      command: xfsProjectQuota.command
    });
  })();
  appliedQuotaCache.set(cacheKey, pending);

  try {
    await pending;
  } catch (error) {
    appliedQuotaCache.delete(cacheKey);
    throw error;
  }
}

export async function listLocalXfsQuotaWorkspaceIds(): Promise<string[]> {
  const backendIds = listConfiguredLocalXfsProjectQuotaBackends().map((backend) => backend.id);
  if (backendIds.length === 0) {
    return [];
  }

  const workspacesRes = await query<{ id: string }>(
    `SELECT id
       FROM workspaces
      WHERE storage_backend_id = ANY($1::text[])
      ORDER BY created_at ASC, id ASC`,
    [backendIds]
  );

  return workspacesRes.rows.map((row) => row.id);
}
