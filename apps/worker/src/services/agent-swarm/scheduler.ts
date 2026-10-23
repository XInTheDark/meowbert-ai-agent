import type { PoolClient } from "pg";
import { enqueueSubagentRun } from "../subagents/dispatch.js";

// Every transaction that changes lanes takes the swarm row first, then task rows from parent to child,
// so concurrent lane transitions in one swarm never deadlock and the running-lane count stays exact.
export async function lockSwarmInTx(client: PoolClient, swarmTaskId: string): Promise<{ config_json: unknown } | null> {
  const result = await client.query<{ config_json: unknown }>(
    "SELECT config_json FROM task_swarms WHERE task_id = $1 FOR UPDATE",
    [swarmTaskId]
  );
  return result.rows[0] ?? null;
}

// Starts queued lanes while fewer than `maxRunningLanes` run. Lanes whose siblings already started go
// first, since finishing a sibling group unblocks its parent; then oldest first. Caller holds the swarm lock.
export async function startQueuedLanesInTx(client: PoolClient, swarmTaskId: string, maxRunningLanes: number): Promise<string[]> {
  const running = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM task_swarm_lanes WHERE swarm_task_id = $1 AND status = 'running'",
    [swarmTaskId]
  );
  const capacity = maxRunningLanes - Number(running.rows[0]?.count ?? 0);
  if (capacity <= 0) return [];
  const queued = await client.query<{ task_id: string; workspace_id: string; environment_id: string; initiator_user_id: string | null }>(
    `SELECT lane.task_id, task.workspace_id, task.environment_id, task.initiator_user_id
       FROM task_swarm_lanes lane
       JOIN tasks task ON task.id = lane.task_id
      WHERE lane.swarm_task_id = $1
        AND lane.status = 'queued'
        AND NOT task.cancellation_requested
      ORDER BY EXISTS (
                 SELECT 1 FROM task_swarm_lanes sibling
                  WHERE sibling.parent_task_id = lane.parent_task_id
                    AND sibling.task_id <> lane.task_id
                    AND sibling.status <> 'queued'
               ) DESC,
               lane.created_at, lane.task_id
      LIMIT $2`,
    [swarmTaskId, capacity]
  );
  for (const lane of queued.rows) {
    await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [lane.task_id]);
    await enqueueSubagentRun(client, {
      taskId: lane.task_id,
      workspaceId: lane.workspace_id,
      environmentId: lane.environment_id,
      triggerSource: "web",
      mode: "agent_swarm_lane",
      selectionUserId: lane.initiator_user_id ?? undefined
    });
    await client.query(
      `UPDATE task_swarm_lanes SET status = 'running', started_at = COALESCE(started_at, now()), updated_at = now()
        WHERE task_id = $1`,
      [lane.task_id]
    );
  }
  return queued.rows.map((lane) => lane.task_id);
}
