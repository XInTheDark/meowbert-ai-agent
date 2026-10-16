import { XfsProjectQuotaManager } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { resolveWorkspaceStorageLimitBytes } from "../agent-db/user-resource-limits.js";
import { claimWorkspaceStorageProjectId } from "./local-xfs-project-quotas.js";

const xfsProjectQuotaManager = new XfsProjectQuotaManager();
const appliedQuotaCache = new Map<string, Promise<void>>();

// Scratch gets the same per-workspace limit as workspace storage, on its own XFS filesystem.
export async function ensureWorkspaceScratchQuota(input: {
  workspaceId: string;
  workspaceScratchDir: string;
}): Promise<void> {
  const xfsProjectQuota = config.runtime.taskScratch.xfsProjectQuota;
  if (!xfsProjectQuota) return;

  const limitBytes = await resolveWorkspaceStorageLimitBytes(input.workspaceId);
  if (limitBytes === null) return;

  const cacheKey = `${input.workspaceId}:${input.workspaceScratchDir}:${limitBytes}`;
  const existing = appliedQuotaCache.get(cacheKey);
  if (existing) {
    await existing;
    return;
  }

  const pending = (async () => {
    const projectId = await claimWorkspaceStorageProjectId(input.workspaceId, xfsProjectQuota.projectIdBase);
    await xfsProjectQuotaManager.applyProjectQuota({
      mountPath: xfsProjectQuota.mountPath,
      storageUnitRoot: input.workspaceScratchDir,
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
