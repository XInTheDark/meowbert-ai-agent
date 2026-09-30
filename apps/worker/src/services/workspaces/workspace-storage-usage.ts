import { buildStorageUsageSummary, calculatePathsUsageBytes, type StorageUsageSummary } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { resolveWorkspaceStorageLimitBytes } from "../agent-db/user-resource-limits.js";
import { resolveTaskEnvironmentRoot } from "../runtime/environment-storage.js";
import { resolveTaskWorkspaceRoot } from "./workspace-storage.js";

interface WorkspaceStorageUsageInput {
  workspaceId: string;
  workspaceRootPath: string;
  actorUserId?: string | null;
  actorIsSuperAdmin?: boolean;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((entry) => entry.trim()).filter((entry) => entry.length > 0)));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return unitIndex === 0 ? `${Math.round(value)} ${units[unitIndex]}` : `${value.toFixed(1)} ${units[unitIndex]}`;
}

async function resolveWorkspaceStorageRoots(input: WorkspaceStorageUsageInput): Promise<string[]> {
  const workspaceRoot = await resolveTaskWorkspaceRoot({
    workspaceId: input.workspaceId,
    rootPath: input.workspaceRootPath
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
      resolveTaskEnvironmentRoot({
        workspaceId: environment.workspace_id,
        environmentId: environment.id,
        rootPath: environment.root_path
      })
    )
  );

  return uniquePaths([workspaceRoot, ...environmentRoots]);
}

export async function getWorkspaceStorageUsage(input: WorkspaceStorageUsageInput): Promise<StorageUsageSummary> {
  const roots = await resolveWorkspaceStorageRoots(input);
  const usedBytes = await calculatePathsUsageBytes(roots);
  return buildStorageUsageSummary({
    usedBytes,
    limitBytes: await resolveWorkspaceStorageLimitBytes(input.workspaceId)
  });
}

export function throwIfWorkspaceStorageLimitExceeded(storage: StorageUsageSummary): void {
  if (!storage.isOverLimit || storage.limitBytes === null) {
    return;
  }

  throw new Error(
    `Workspace storage limit exceeded (${formatBytes(storage.usedBytes)} used / ${formatBytes(storage.limitBytes)} limit). Delete files or run cleanup and try again.`
  );
}
