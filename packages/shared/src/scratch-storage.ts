import fs from "node:fs/promises";
import type { TaskScratchConfig } from "./config.js";
import { XfsProjectQuotaManager } from "./xfs-project-quota.js";

export interface ScratchStorageStatus {
  capacityBytes: number;
  usedBytes: number;
  availableBytes: number;
  limitMb: number | null;
  effectiveLimitBytes: number;
}

// The backing filesystem is the pool boundary. No directory walks, including on non-XFS hosts.
export async function readScratchStorage(root: string, limitMb: number | null): Promise<ScratchStorageStatus> {
  const stat = await fs.statfs(root);
  const capacityBytes = stat.blocks * stat.bsize;
  const availableBytes = stat.bavail * stat.bsize;
  return {
    capacityBytes,
    usedBytes: (stat.blocks - stat.bfree) * stat.bsize,
    availableBytes,
    limitMb,
    effectiveLimitBytes: Math.min(capacityBytes, limitMb === null ? capacityBytes : limitMb * 1024 * 1024)
  };
}

export async function readScratchProjectSizes(config: TaskScratchConfig): Promise<Map<number, number> | null> {
  if (!config.xfsProjectQuota) return null;
  return new XfsProjectQuotaManager().readProjectUsage(config.xfsProjectQuota);
}
