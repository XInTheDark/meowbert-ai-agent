import { normalizeAgentSwarmSettings } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { enqueueSubagentRun } from "../subagents/dispatch.js";
import { wakeParentIfBarrierMetInTx } from "./barrier.js";
import { lockSwarmInTx, startQueuedLanesInTx } from "./scheduler.js";
import { buildUnsubmittedLaneResult } from "@meowbert/run-executor/agent-swarm/forced-submit";
import { dropDiscardedResultInTx, loadLane, setLaneStatusInTx } from "./lane-store.js";
import { endCancelledIdleLeaders } from "./cancelled-leaders.js";

const RECOVERY_BATCH_SIZE = 100;

// A missing queue job is a recovery condition, not a reason to cancel: parents whose barrier is met
// but which have no open run are woken, and finished results nobody merged wake their parent.
async function wakeParkedParents(): Promise<void> {
  const parked = await query<{ task_id: string; swarm_task_id: string }>(
    `SELECT park.task_id, park.swarm_task_id
       FROM task_swarm_parks park
       JOIN tasks task ON task.id = park.task_id
      WHERE NOT task.cancellation_requested AND task.trashed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM task_runs run WHERE run.task_id = park.task_id AND run.ended_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM task_swarm_lanes lane
                         WHERE lane.parent_task_id = park.task_id AND lane.status IN ('queued', 'running', 'waiting'))
      ORDER BY park.created_at
      LIMIT $1`,
    [RECOVERY_BATCH_SIZE]
  );
  for (const row of parked.rows) {
    await withTransaction(async (client) => {
      await lockSwarmInTx(client, row.swarm_task_id);
      await wakeParentIfBarrierMetInTx(client, row.task_id);
    });
  }
}

// Results that finished after the parent's last step (a parent that was not parked) are delivered by
// a fresh run of the parent, so they never sit unread.
async function wakeParentsWithUnmergedResults(): Promise<void> {
  const parents = await query<{
    task_id: string; swarm_task_id: string; workspace_id: string; environment_id: string;
    initiator_user_id: string | null; is_lane: boolean;
  }>(
    `SELECT DISTINCT parent.id AS task_id, lane.swarm_task_id, parent.workspace_id, parent.environment_id,
            parent.initiator_user_id, parent.workflow_internal_role = 'lane' AS is_lane
       FROM task_swarm_lanes lane
       JOIN tasks parent ON parent.id = lane.parent_task_id
       JOIN tasks root ON root.id = lane.swarm_task_id
      WHERE lane.merged_at IS NULL AND lane.status IN ('done', 'failed', 'stopped')
        AND NOT parent.cancellation_requested AND parent.trashed_at IS NULL
        AND parent.status NOT IN ('failed', 'cancelled')
        -- A lane parent that already submitted is never restarted from here.
        AND (parent.workflow_internal_role IS DISTINCT FROM 'lane' OR EXISTS (
              SELECT 1 FROM task_swarm_lanes own WHERE own.task_id = parent.id AND own.status IN ('running', 'waiting')))
        AND NOT root.cancellation_requested AND root.status <> 'cancelled'
        AND NOT EXISTS (SELECT 1 FROM task_swarm_parks park WHERE park.task_id = parent.id)
        AND NOT EXISTS (SELECT 1 FROM task_runs run WHERE run.task_id = parent.id AND run.ended_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM task_swarm_lanes active
                         WHERE active.parent_task_id = parent.id AND active.status IN ('queued', 'running', 'waiting'))
      LIMIT $1`,
    [RECOVERY_BATCH_SIZE]
  );
  for (const parent of parents.rows) {
    await withTransaction(async (client) => {
      await lockSwarmInTx(client, parent.swarm_task_id);
      await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [parent.task_id]);
      const open = await client.query("SELECT id FROM task_runs WHERE task_id = $1 AND ended_at IS NULL LIMIT 1", [parent.task_id]);
      if (open.rowCount) return;
      await enqueueSubagentRun(client, {
        taskId: parent.task_id,
        workspaceId: parent.workspace_id,
        environmentId: parent.environment_id,
        triggerSource: "web",
        mode: parent.is_lane ? "agent_swarm_lane" : "agent_swarm_leader",
        selectionUserId: parent.initiator_user_id ?? undefined
      });
      if (parent.is_lane) {
        await client.query("UPDATE task_swarm_lanes SET status = 'running', updated_at = now() WHERE task_id = $1", [parent.task_id]);
      }
    });
  }
}

// Queued lanes start as soon as there is room; this catches room freed by a transition that failed.
async function startWaitingQueues(): Promise<void> {
  const swarms = await query<{ swarm_task_id: string }>(
    `SELECT DISTINCT lane.swarm_task_id
       FROM task_swarm_lanes lane
       JOIN tasks root ON root.id = lane.swarm_task_id
      WHERE lane.status = 'queued' AND NOT root.cancellation_requested
      LIMIT $1`,
    [RECOVERY_BATCH_SIZE]
  );
  for (const swarm of swarms.rows) {
    await withTransaction(async (client) => {
      const row = await lockSwarmInTx(client, swarm.swarm_task_id);
      if (!row) return;
      await startQueuedLanesInTx(client, swarm.swarm_task_id, normalizeAgentSwarmSettings(row.config_json).advanced.maxRunningLanes);
    });
  }
}

// Lanes stopped from the task page while they had no run (queued, or parked on lanes of their own)
// carry only their cancellation flag; they end here, and their parent resumes as usual.
async function endCancelledIdleLanes(): Promise<void> {
  const lanes = await query<{ task_id: string; swarm_task_id: string; parent_task_id: string; status: string }>(
    `SELECT lane.task_id, lane.swarm_task_id, lane.parent_task_id, lane.status
       FROM task_swarm_lanes lane
       JOIN tasks task ON task.id = lane.task_id
      WHERE lane.status IN ('queued', 'waiting') AND task.cancellation_requested
        AND NOT EXISTS (SELECT 1 FROM task_runs run WHERE run.task_id = lane.task_id AND run.ended_at IS NULL)
      LIMIT $1`,
    [RECOVERY_BATCH_SIZE]
  );
  for (const lane of lanes.rows) {
    await withTransaction(async (client) => {
      const swarm = await lockSwarmInTx(client, lane.swarm_task_id);
      if (!swarm) return;
      await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [lane.parent_task_id]);
      const current = await loadLane(client, lane.task_id, { forUpdate: true });
      if (!current || !["queued", "waiting"].includes(current.status)) return;
      await client.query(
        "UPDATE tasks SET status = 'cancelled', completed_at = now(), updated_at = now() WHERE id = $1",
        [lane.task_id]
      );
      await client.query("DELETE FROM task_swarm_parks WHERE task_id = $1", [lane.task_id]);
      await setLaneStatusInTx(client, lane.task_id, "stopped", {
        result: buildUnsubmittedLaneResult(current.status === "queued" ? "Stopped before it started." : "Stopped and discarded.")
      });
      await dropDiscardedResultInTx(client, current);
      await startQueuedLanesInTx(client, lane.swarm_task_id, normalizeAgentSwarmSettings(swarm.config_json).advanced.maxRunningLanes);
      await wakeParentIfBarrierMetInTx(client, lane.parent_task_id);
    });
  }
}

export async function recoverSwarmsOnce(): Promise<void> {
  await endCancelledIdleLeaders(RECOVERY_BATCH_SIZE);
  await endCancelledIdleLanes();
  await wakeParkedParents();
  await wakeParentsWithUnmergedResults();
  await startWaitingQueues();
}

export function startSwarmRecoveryLoop(): { stop: () => Promise<void> } {
  let pending: Promise<void> | null = null;
  const run = () => {
    pending ??= recoverSwarmsOnce().catch((error) => console.error("Agent Swarm recovery failed", error))
      .finally(() => { pending = null; });
  };
  const timer = setInterval(run, 5_000);
  run();
  return { stop: async () => { clearInterval(timer); await pending; } };
}
