import fsPromises from "node:fs/promises";
import { buildStorageUsageSummary, resolveWorkspaceStorageUnitRoot, type StorageUsageSummary } from "@meowbert/shared";
import { hasLocalXfsProjectQuota } from "../storage/local-xfs-project-quotas.js";
import { resolveWorkspaceStorageLimitBytes } from "../users/resource-limits.js";
import { ensureWorkspaceStorageRoot, resolveWorkspaceBackendId } from "./workspace-storage.js";

interface WorkspaceStorageUsageInput {
  workspaceId: string;
  workspaceRootPath: string;
}

// Usage comes from one statfs call, never from walking the tree: workspaces can live on
// network mounts (rclone, NFS) where a walk takes minutes. Only an XFS project quota makes
// statfs report a single workspace's usage, so other backends have no usage to report.
export async function getWorkspaceStorageUsage(input: WorkspaceStorageUsageInput): Promise<StorageUsageSummary | null> {
  const storageBackendId = await resolveWorkspaceBackendId(input.workspaceId);
  if (!hasLocalXfsProjectQuota(storageBackendId)) {
    return null;
  }

  const workspaceRoot = await ensureWorkspaceStorageRoot({
    id: input.workspaceId,
    root_path: input.workspaceRootPath,
    storage_backend_id: storageBackendId
  });
  const stats = await fsPromises.statfs(resolveWorkspaceStorageUnitRoot(workspaceRoot));
  return buildStorageUsageSummary({
    usedBytes: (stats.blocks - stats.bfree) * stats.bsize,
    limitBytes: await resolveWorkspaceStorageLimitBytes(input.workspaceId)
  });
}
