import type { PoolClient } from "pg";
import type { TaskExecutionJob } from "@meowbert/shared";
import { enqueueSubagentRun } from "../subagents/dispatch.js";
import { countActiveChildrenInTx } from "./lane-store.js";
import { normalizeAgentSwarmSettings } from "@meowbert/shared";
import { startQueuedLanesInTx } from "./scheduler.js";

// A parent's barrier is met once none of its direct lanes is queued, running or waiting. It is checked
// in the transaction that changes a child's status, so nothing polls. When it is met and the parent is
// parked, the parent's stored resume job is enqueued; its run then receives the merge message.
// Caller holds the swarm lock.
export async function wakeParentIfBarrierMetInTx(client: PoolClient, parentTaskId: string): Promise<boolean> {
  const parent = await client.query<{ cancellation_requested: boolean; status: string }>(
    "SELECT cancellation_requested, status FROM tasks WHERE id = $1 FOR UPDATE",
    [parentTaskId]
  );
  // Waking re-queues the parent, which would clear a cancellation; a cancelled parent stays put.
  if (!parent.rows[0] || parent.rows[0].cancellation_requested || parent.rows[0].status === "cancelled") return false;
  if (await countActiveChildrenInTx(client, parentTaskId) > 0) return false;
  const park = await client.query<{ resume_job_json: TaskExecutionJob }>(
    "SELECT resume_job_json FROM task_swarm_parks WHERE task_id = $1",
    [parentTaskId]
  );
  if (!park.rows[0]) return false;
  const open = await client.query("SELECT id FROM task_runs WHERE task_id = $1 AND ended_at IS NULL LIMIT 1", [parentTaskId]);
  if (open.rowCount) return false;
  const lane = await client.query<{ swarm_task_id: string; config_json: unknown }>(
    `SELECT lane.swarm_task_id, swarm.config_json FROM task_swarm_lanes lane
       JOIN task_swarms swarm ON swarm.task_id = lane.swarm_task_id WHERE lane.task_id = $1`,
    [parentTaskId]
  );
  if (lane.rows[0]) {
    await client.query("UPDATE task_swarm_lanes SET status = 'queued', updated_at = now() WHERE task_id = $1", [parentTaskId]);
    const started = await startQueuedLanesInTx(client, lane.rows[0].swarm_task_id,
      normalizeAgentSwarmSettings(lane.rows[0].config_json).advanced.maxRunningLanes);
    return started.includes(parentTaskId);
  }
  // Resolve the latest branch on startup, including messages persisted before parking.
  await enqueueSubagentRun(client, { ...park.rows[0].resume_job_json, branchMessageId: undefined });
  await client.query("DELETE FROM task_swarm_parks WHERE task_id = $1", [parentTaskId]);
  return true;
}
