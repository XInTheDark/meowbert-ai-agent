import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { resolveTaskScratchDir, resolveWorkspaceScratchDir } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { withTransaction } from "../../lib/db.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SWEEP_INTERVAL_MS = 3_600_000;
const MAX_RECLAIMS_PER_SWEEP = 20;

interface ScratchDir { workspaceId: string; taskId: string }

let lastSweepAt = 0;

async function listUuidDirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name)).map((entry) => entry.name);
}

// Two levels of names under the scratch root, which is local disk Meowbert owns. Nothing inside a task folder is read.
async function listTaskScratchDirs(root: string): Promise<ScratchDir[]> {
  const dirs: ScratchDir[] = [];
  for (const workspaceId of await listUuidDirs(root)) {
    for (const taskId of await listUuidDirs(resolveWorkspaceScratchDir(root, workspaceId))) dirs.push({ workspaceId, taskId });
  }
  return dirs;
}

// Scratch with no task that owns it: the task or workspace was deleted, or an earlier removal failed.
async function findOrphans(client: PoolClient, dirs: ScratchDir[]): Promise<ScratchDir[]> {
  if (!dirs.length) return [];
  const owned = await client.query<{ id: string; workspace_id: string }>(
    "SELECT id, workspace_id FROM tasks WHERE id = ANY($1::uuid[]) AND scratch_present",
    [dirs.map((dir) => dir.taskId)]
  );
  const ownedKeys = new Set(owned.rows.map((row) => `${row.workspace_id}/${row.id}`));
  return dirs.filter((dir) => !ownedKeys.has(`${dir.workspaceId}/${dir.taskId}`));
}

// Rechecked under the task lock, which scratch preparation also holds while it creates a folder.
async function detachOrphan(dir: ScratchDir): Promise<string | null> {
  return withTransaction(async (client) => {
    const row = await client.query<{ workspace_id: string; scratch_present: boolean }>(
      "SELECT workspace_id, scratch_present FROM tasks WHERE id = $1 FOR UPDATE", [dir.taskId]
    );
    const task = row.rows[0];
    if (task && task.workspace_id === dir.workspaceId && task.scratch_present) return null;
    const root = config.runtime.taskScratch.root;
    const trash = path.join(root, ".trash", randomUUID());
    await fs.mkdir(path.dirname(trash), { recursive: true });
    try {
      await fs.rename(resolveTaskScratchDir(root, dir.workspaceId, dir.taskId), trash);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    return trash;
  });
}

export async function reclaimOrphanScratch(client: PoolClient, nowMs = Date.now()): Promise<number> {
  if (nowMs - lastSweepAt < SWEEP_INTERVAL_MS) return 0;
  lastSweepAt = nowMs;
  const orphans = await findOrphans(client, await listTaskScratchDirs(config.runtime.taskScratch.root));
  let removed = 0;
  for (const orphan of orphans.slice(0, MAX_RECLAIMS_PER_SWEEP)) {
    const trash = await detachOrphan(orphan);
    if (!trash) continue;
    await fs.rm(trash, { recursive: true, force: true });
    removed++;
  }
  // A backlog continues on the next pass instead of waiting an hour.
  if (orphans.length > MAX_RECLAIMS_PER_SWEEP) lastSweepAt = 0;
  return removed;
}
