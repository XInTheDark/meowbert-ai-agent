import type { PoolClient } from "pg";
import type { TaskStatus } from "@meowbert/shared";
import { query } from "../../lib/db.js";

// How far back the sweep looks for tasks that went idle while no worker was listening.
const IDLE_SWEEP_LOOKBACK_HOURS = 24;

export interface IdleTask {
  workspace_id: string;
  environment_id: string;
  initiator_user_id: string | null;
  status: TaskStatus;
}

// An enabled Project Master always qualifies. Other top-level tasks qualify while the admin
// setting is on; subtasks, workflow steps, threads and swarm lanes are driven by their parent.
const IDLE_COMPACTION_ELIGIBLE = `
  t.trashed_at IS NULL
  AND t.status NOT IN ('queued', 'starting', 'running')
  AND (
    (
      EXISTS (SELECT 1 FROM project_masters pm WHERE pm.task_id = t.id)
      AND COALESCE(ws.model_defaults_json->>'projectMasterEnabled', 'true') <> 'false'
    )
    OR (
      EXISTS (SELECT 1 FROM platform_settings ps WHERE ps.id = 1 AND ps.idle_compaction_for_tasks)
      AND NOT EXISTS (SELECT 1 FROM project_masters pm WHERE pm.task_id = t.id)
      AND t.parent_task_id IS NULL
      AND t.workflow_parent_task_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM task_threads tt WHERE tt.task_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM task_swarm_lanes sl WHERE sl.task_id = t.id)
    )
  )`;

export async function lockIdleCompactableTask(client: PoolClient, taskId: string): Promise<IdleTask | null> {
  const result = await client.query<IdleTask>(
    `SELECT t.workspace_id, t.environment_id, t.initiator_user_id, t.status
       FROM tasks t
       LEFT JOIN workspace_settings ws ON ws.workspace_id = t.workspace_id
      WHERE t.id = $1
        AND ${IDLE_COMPACTION_ELIGIBLE}
        AND NOT EXISTS (SELECT 1 FROM task_runs tr WHERE tr.task_id = t.id AND tr.ended_at IS NULL)
        FOR UPDATE OF t`,
    [taskId]
  );
  return result.rows[0] ?? null;
}

// Eligible tasks that ran recently, most recent first, for catching up after a restart or a missed notification.
export async function listRecentlyIdleTasks(limit: number): Promise<string[]> {
  const result = await query<{ task_id: string }>(
    `SELECT t.id AS task_id
       FROM (
              SELECT task_id, MAX(ended_at) AS last_ended_at
                FROM task_runs
               WHERE ended_at > now() - make_interval(hours => $2)
               GROUP BY task_id
            ) recent
       JOIN tasks t ON t.id = recent.task_id
       LEFT JOIN workspace_settings ws ON ws.workspace_id = t.workspace_id
      WHERE ${IDLE_COMPACTION_ELIGIBLE}
      ORDER BY recent.last_ended_at DESC
      LIMIT $1`,
    [limit, IDLE_SWEEP_LOOKBACK_HOURS]
  );
  return result.rows.map((row) => row.task_id);
}
