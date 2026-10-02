import { resolveWorkspaceStorageLimitBytes } from "../users/resource-limits.js";
import { getWorkspaceStorageUsage } from "./workspace-storage-usage.js";
import {
  addToRememberedWorkspaceUsedBytes,
  readRememberedWorkspaceUsedBytes
} from "./workspace-storage-usage-cache.js";

// The soft workspace storage limit for files users add through the app. Hard limits on
// everything a task sandbox writes need XFS project quotas on the storage backend.

export interface WorkspaceStorageTarget {
  workspaceId: string;
  workspaceRootPath: string;
  actorUserId: string;
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

export class WorkspaceStorageLimitError extends Error {
  readonly statusCode = 413;
  readonly exposeMessage = true;

  constructor(availableBytes: number) {
    super(availableBytes > 0
      ? `Not enough workspace storage for this file (${formatBytes(availableBytes)} left). Delete files to free up space.`
      : "Workspace storage is full. Delete files to free up space.");
    this.name = "WorkspaceStorageLimitError";
  }
}

// Bytes new files may still add, or null when the workspace has no limit. Uses the usage
// remembered from the last scan and only rescans when nothing is remembered.
export async function resolveAvailableWorkspaceBytes(target: WorkspaceStorageTarget): Promise<number | null> {
  const limitBytes = await resolveWorkspaceStorageLimitBytes(target.workspaceId);
  if (limitBytes === null) {
    return null;
  }

  const usedBytes = readRememberedWorkspaceUsedBytes(target.workspaceId)
    ?? (await getWorkspaceStorageUsage(target)).usedBytes;
  return Math.max(0, limitBytes - usedBytes);
}

export function assertWorkspaceStorageAvailable(availableBytes: number | null, requiredBytes: number): void {
  if (availableBytes === null) {
    return;
  }
  if (availableBytes <= 0 || requiredBytes > availableBytes) {
    throw new WorkspaceStorageLimitError(availableBytes);
  }
}

export function recordWorkspaceBytesAdded(workspaceId: string, bytes: number): void {
  addToRememberedWorkspaceUsedBytes(workspaceId, bytes);
}
