import fsPromises from "node:fs/promises";
import path from "node:path";

export interface StorageUsageSummary {
  usedBytes: number;
  limitBytes: number | null;
  availableBytes: number | null;
  usagePercent: number | null;
  isOverLimit: boolean;
}

interface UsageTraversalState {
  seenInodes: Set<string>;
}

function buildInodeKey(stats: { dev: number; ino: number }): string {
  return `${stats.dev}:${stats.ino}`;
}

async function calculatePathUsageBytesInternal(
  absolutePath: string,
  state: UsageTraversalState
): Promise<number> {
  const stats = await fsPromises.lstat(absolutePath).catch(() => null);
  if (!stats) {
    return 0;
  }

  if (stats.isSymbolicLink()) {
    return 0;
  }

  const inodeKey = buildInodeKey(stats);
  if (state.seenInodes.has(inodeKey)) {
    return 0;
  }
  state.seenInodes.add(inodeKey);

  if (stats.isFile()) {
    return stats.size;
  }

  if (!stats.isDirectory()) {
    return 0;
  }

  const entries = await fsPromises.readdir(absolutePath, { withFileTypes: true }).catch(() => []);
  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += await calculatePathUsageBytesInternal(path.join(absolutePath, entry.name), state);
  }

  return totalBytes;
}

export async function calculatePathUsageBytes(absolutePath: string): Promise<number> {
  return calculatePathUsageBytesInternal(path.resolve(absolutePath), {
    seenInodes: new Set<string>()
  });
}

export function buildStorageUsageSummary(input: {
  usedBytes: number;
  limitBytes?: number | null;
}): StorageUsageSummary {
  const limitBytes = typeof input.limitBytes === "number" && Number.isFinite(input.limitBytes) && input.limitBytes > 0
    ? input.limitBytes
    : null;

  const availableBytes = limitBytes === null ? null : Math.max(0, limitBytes - input.usedBytes);
  const usagePercent = limitBytes === null ? null : Math.min(100, (input.usedBytes / limitBytes) * 100);

  return {
    usedBytes: input.usedBytes,
    limitBytes,
    availableBytes,
    usagePercent,
    isOverLimit: limitBytes !== null && input.usedBytes > limitBytes
  };
}
