import type { PoolClient } from "pg";
import type { ScratchUsageBreakdown } from "@meowbert/shared";

export interface TrackedScratch {
  workspaceId: string;
  sizeBytes: number;
  idle: boolean;
}

export function summarizeScratchUsage(tracked: TrackedScratch[], usedBytes: number, measuredAt: Date): ScratchUsageBreakdown {
  let activeBytes = 0;
  let idleBytes = 0;
  for (const task of tracked) {
    if (task.idle) idleBytes += task.sizeBytes;
    else activeBytes += task.sizeBytes;
  }
  return {
    measuredAt: measuredAt.toISOString(),
    activeBytes,
    idleBytes,
    untrackedBytes: Math.max(0, usedBytes - activeBytes - idleBytes)
  };
}

export function scratchBytesByWorkspace(tracked: TrackedScratch[]): Map<string, number> {
  const bytes = new Map<string, number>();
  for (const task of tracked) bytes.set(task.workspaceId, (bytes.get(task.workspaceId) ?? 0) + task.sizeBytes);
  return bytes;
}

// The API shows this to admins; it cannot read XFS quotas itself.
export async function saveScratchUsage(client: PoolClient, usage: ScratchUsageBreakdown | null): Promise<void> {
  await client.query("UPDATE platform_settings SET scratch_usage = $1 WHERE id = 1", [usage === null ? null : JSON.stringify(usage)]);
}
