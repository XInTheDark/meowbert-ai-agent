import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { resolveTaskScratchDir, type ScratchCandidate } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { withTransaction } from "../../lib/db.js";

export interface ScratchTaskRow {
  id: string;
  workspace_id: string;
  scratch_project_id: number | null;
  idle_since: string;
}

// Shared by candidate selection and the final locked recheck.
const ELIGIBLE_SCRATCH_SQL = `t.scratch_present
  AND t.status NOT IN ('queued', 'starting', 'running')
  AND GREATEST(t.updated_at, COALESCE((SELECT MAX(ended_at) FROM task_runs WHERE task_id = t.id), t.updated_at)) < $1::timestamptz
  AND NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.task_id = t.id AND r.ended_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM persistent_shell_sessions s WHERE s.created_by_task_id = t.id AND s.status IN ('starting', 'running', 'idle'))
  AND NOT EXISTS (
    SELECT 1 FROM task_swarm_lanes lane JOIN tasks root ON root.id = lane.swarm_task_id
    WHERE (lane.task_id = t.id OR lane.swarm_task_id = t.id)
      AND (root.status IN ('queued', 'starting', 'running') OR lane.status IN ('queued', 'running', 'waiting')
        OR EXISTS (SELECT 1 FROM task_runs r WHERE r.task_id = root.id AND r.ended_at IS NULL)))`;

export async function listIdleScratchTasks(client: PoolClient, cutoff: string): Promise<ScratchTaskRow[]> {
  const result = await client.query<ScratchTaskRow>(
    `SELECT t.id, t.workspace_id, t.scratch_project_id,
            GREATEST(t.updated_at, COALESCE((SELECT MAX(ended_at) FROM task_runs WHERE task_id = t.id), t.updated_at))::text AS idle_since
       FROM tasks t WHERE ${ELIGIBLE_SCRATCH_SQL}`, [cutoff]
  );
  return result.rows;
}

export async function detachIdleScratch(task: ScratchCandidate, cutoff: string): Promise<string | null> {
  return withTransaction(async (client) => {
    // Run creation and scratch preparation also lock this task row.
    await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [task.id]);
    const eligible = await client.query(`SELECT t.id FROM tasks t WHERE t.id = $2 AND ${ELIGIBLE_SCRATCH_SQL}`, [cutoff, task.id]);
    if (!eligible.rowCount) return null;
    const root = config.runtime.taskScratch.root;
    const trashRoot = path.join(root, ".trash");
    await fs.mkdir(trashRoot, { recursive: true });
    const trash = path.join(trashRoot, randomUUID());
    try {
      await fs.rename(resolveTaskScratchDir(root, task.workspaceId, task.id), trash);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await client.query("UPDATE tasks SET scratch_present = false WHERE id = $1", [task.id]);
      return null;
    }
    await client.query("UPDATE tasks SET scratch_present = false, scratch_evicted_at = now() WHERE id = $1", [task.id]);
    return trash;
  });
}

// A crash between rename and commit leaves the directory here; the next pass finishes deleting it.
export async function drainScratchTrash(root: string): Promise<void> {
  const trash = path.join(root, ".trash");
  await fs.mkdir(trash, { recursive: true });
  const entries = await fs.readdir(trash);
  for (const entry of entries.slice(0, 20)) {
    if (!/^[0-9a-f-]{36}$/.test(entry)) continue;
    await fs.rm(path.join(trash, entry), { recursive: true, force: true });
  }
}
