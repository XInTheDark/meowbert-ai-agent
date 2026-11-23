import fs from "node:fs/promises";
import type { PoolClient } from "pg";
import {
  normalizeScratchPriority, rankScratchCandidates, readScratchProjectSizes, readScratchStorage, scratchCleanupThresholds,
  scratchIdleExpiryMs, type ScratchCandidate
} from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { withConnection } from "../../lib/db.js";
import { workerSandboxManager } from "../runtime/sandbox.js";
import { detachIdleScratch, drainScratchTrash, listIdleScratchTasks } from "./scratch-eviction-store.js";
import { reclaimOrphanScratch } from "./scratch-orphans.js";
import { saveScratchUsage, scratchBytesByWorkspace, summarizeScratchUsage, type TrackedScratch } from "./scratch-usage.js";

const SCRATCH_CLEANUP_LOCK = 1_296_385;
const MAX_EVICTIONS_PER_PASS = 20;

// Expired scratch goes regardless of disk use; under pressure the ranked rest goes until usage is back under target.
async function evictCandidates(candidates: ScratchCandidate[], limitMb: number | null, cutoff: string): Promise<number> {
  const { root, eviction } = config.runtime.taskScratch;
  let status = await readScratchStorage(root, limitMb);
  const thresholds = scratchCleanupThresholds(status, eviction);
  const pressured = thresholds.start(status);
  let removed = 0;
  let attempted = 0;
  for (const task of candidates) {
    const expiryMs = scratchIdleExpiryMs(task, eviction);
    const expired = expiryMs !== null && Date.now() - task.idleSince >= expiryMs;
    const needsSpace = pressured && thresholds.keepGoing(status);
    if (!expired && !needsSpace) continue;
    if (attempted++ >= MAX_EVICTIONS_PER_PASS) break;
    const trash = await detachIdleScratch(task, cutoff);
    if (trash) {
      await fs.rm(trash, { recursive: true, force: true });
      removed++;
      status = await readScratchStorage(root, limitMb);
    }
  }
  return removed;
}

async function readLimitMb(client: PoolClient): Promise<number | null> {
  const settings = await client.query<{ scratch_storage_limit_mb: string | null }>("SELECT scratch_storage_limit_mb FROM platform_settings WHERE id = 1");
  const value = settings.rows[0]?.scratch_storage_limit_mb;
  return value == null ? null : Number(value);
}

async function listCandidates(client: PoolClient, cutoff: string, sizes: Map<number, number> | null): Promise<ScratchCandidate[]> {
  const rows = await listIdleScratchTasks(client, cutoff);
  const containers = await workerSandboxManager.listManagedContainers();
  const mountedTasks = new Set(containers.filter((container) => container.state === "running").map((container) => container.taskId));
  return rows.filter((row) => !mountedTasks.has(row.id)).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    idleSince: new Date(row.idle_since).getTime(),
    sizeBytes: row.scratch_project_id === null ? null : sizes?.get(row.scratch_project_id) ?? null,
    priority: normalizeScratchPriority(row.priority),
    completion: row.completion
  }));
}

async function listTrackedScratch(client: PoolClient, sizes: Map<number, number>, idleIds: Set<string>): Promise<TrackedScratch[]> {
  const usage = await client.query<{ id: string; workspace_id: string; scratch_project_id: number }>(
    "SELECT id, workspace_id, scratch_project_id FROM tasks WHERE scratch_present AND scratch_project_id IS NOT NULL"
  );
  return usage.rows.map((row) => ({
    workspaceId: row.workspace_id, sizeBytes: sizes.get(row.scratch_project_id) ?? 0, idle: idleIds.has(row.id)
  }));
}

async function cleanupLocked(client: PoolClient): Promise<number> {
  const { root, eviction } = config.runtime.taskScratch;
  await fs.mkdir(root, { recursive: true });
  await drainScratchTrash(root);
  const limitMb = await readLimitMb(client);
  const status = await readScratchStorage(root, limitMb);
  const minIdleMs = Math.max(eviction.minIdleMinutes * 60_000, config.runtime.sandbox.sessionIdleTimeoutMs);
  const cutoff = new Date(Date.now() - minIdleMs).toISOString();
  const sizes = await readScratchProjectSizes(config.runtime.taskScratch).catch((error) => {
    console.warn("[scratch] Size accounting unavailable; using age:", error);
    return null;
  });
  const candidates = await listCandidates(client, cutoff, sizes);
  const tracked = sizes ? await listTrackedScratch(client, sizes, new Set(candidates.map((task) => task.id))) : [];
  await saveScratchUsage(client, sizes ? summarizeScratchUsage(tracked, status.usedBytes, new Date()) : null);
  const ranked = rankScratchCandidates(candidates, scratchBytesByWorkspace(tracked), status.effectiveLimitBytes, Date.now(), minIdleMs);
  const evicted = await evictCandidates(ranked, limitMb, cutoff);
  return evicted + await reclaimOrphanScratch(client);
}

export async function cleanupScratchOnce(): Promise<number> {
  return withConnection(async (client) => {
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [SCRATCH_CLEANUP_LOCK]);
    if (!lock.rows[0]?.acquired) return 0;
    try {
      return await cleanupLocked(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SCRATCH_CLEANUP_LOCK]);
    }
  });
}

export function startScratchCleanupLoop(): { stop: () => Promise<void> } {
  let pending: Promise<unknown> | null = null;
  const run = () => {
    if (pending) return;
    pending = cleanupScratchOnce().then((count) => {
      if (count) console.log(`[scratch] Cleared ${count} idle task scratch directories`);
    }).catch((error) => console.error("[scratch] Cleanup failed:", error)).finally(() => { pending = null; });
  };
  run();
  const timer = setInterval(run, 60_000);
  return { stop: async () => { clearInterval(timer); await pending; } };
}
