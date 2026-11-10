import { normalizeCachebeatSettings, type CachebeatSettings, type TaskStatus } from "@meowbert/shared";
import { query } from "../../lib/db.js";

export interface CachebeatPlatformSettings {
  cachebeat: CachebeatSettings;
  modelMetadata: unknown;
}

export async function loadCachebeatPlatformSettings(): Promise<CachebeatPlatformSettings> {
  const result = await query<{ cachebeat_json: unknown; model_metadata_json: unknown }>(
    "SELECT cachebeat_json, model_metadata_json FROM platform_settings WHERE id = 1"
  );
  const row = result.rows[0];
  return { cachebeat: normalizeCachebeatSettings(row?.cachebeat_json ?? null), modelMetadata: row?.model_metadata_json ?? null };
}

export interface CachebeatTask {
  status: TaskStatus;
  nextRunAtMs: number | null;
}

// An idle top-level task with no run in flight. Subtasks, workflow steps, threads and swarm lanes
// are driven by their parent, whose own requests keep the shared cache warm.
export async function loadIdleCachebeatTask(taskId: string): Promise<CachebeatTask | null> {
  const result = await query<{ status: TaskStatus; next_run_at: Date | null }>(
    `SELECT t.status,
            (SELECT s.next_run_at FROM task_schedules s WHERE s.task_id = t.id AND s.schedule_state = 'active') AS next_run_at
       FROM tasks t
      WHERE t.id = $1
        AND t.trashed_at IS NULL
        AND t.status NOT IN ('queued', 'starting', 'running')
        AND t.parent_task_id IS NULL
        AND t.workflow_parent_task_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM task_threads tt WHERE tt.task_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM task_swarm_lanes sl WHERE sl.task_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM task_runs tr WHERE tr.task_id = t.id AND tr.ended_at IS NULL)`,
    [taskId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { status: row.status, nextRunAtMs: row.next_run_at ? row.next_run_at.getTime() : null };
}
