import { buildStorageUsageSummary, calculatePathsUsageBytes, type StorageUsageSummary } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "../environments/environment-storage.js";
import { resolveWorkspaceStorageLimitBytes } from "../users/resource-limits.js";
import { ensureWorkspaceStorageRoot } from "./workspace-storage.js";
import { rememberWorkspaceUsedBytes } from "./workspace-storage-usage-cache.js";
import { dedupeNestedWorkspaceStorageRoots } from "./workspace-storage-roots.js";

interface WorkspaceStorageUsageInput {
  workspaceId: string;
  workspaceRootPath: string;
  actorUserId?: string | null;
  actorIsSuperAdmin?: boolean;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((entry) => entry.trim()).filter((entry) => entry.length > 0)));
}

async function resolveWorkspaceStorageRoots(input: WorkspaceStorageUsageInput): Promise<string[]> {
  const workspaceRoot = await ensureWorkspaceStorageRoot({
    id: input.workspaceId,
    root_path: input.workspaceRootPath
  });

  const environmentRes = await query<{
    id: string;
    workspace_id: string;
    root_path: string;
  }>(
    `SELECT id, workspace_id, root_path
       FROM environments
      WHERE workspace_id = $1`,
    [input.workspaceId]
  );

  const environmentRoots = await Promise.all(
    environmentRes.rows.map((environment) =>
      ensureEnvironmentStorageRoot({
        id: environment.id,
        workspace_id: environment.workspace_id,
        root_path: environment.root_path
      })
    )
  );

  return dedupeNestedWorkspaceStorageRoots(uniquePaths([workspaceRoot, ...environmentRoots]));
}

export async function getWorkspaceStorageUsage(input: WorkspaceStorageUsageInput): Promise<StorageUsageSummary> {
  const roots = await resolveWorkspaceStorageRoots(input);
  const usedBytes = await calculatePathsUsageBytes(roots);
  rememberWorkspaceUsedBytes(input.workspaceId, usedBytes);
  return buildStorageUsageSummary({
    usedBytes,
    limitBytes: await resolveWorkspaceStorageLimitBytes(input.workspaceId)
  });
}
