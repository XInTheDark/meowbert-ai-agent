import type { PoolClient } from "pg";
import { withTransaction } from "../../lib/db.js";
import { wakeParentIfBarrierMetInTx } from "./barrier.js";
import type { SwarmRunContext } from "./config.js";
import { isLaneResumableInTx } from "./dormancy.js";
import { buildUnsubmittedLaneResult } from "./forced-submit.js";
import { insertLaneInboxInTx } from "./lane-inbox.js";
import {
  ACTIVE_LANE_STATUSES,
  dropDiscardedResultInTx,
  listDescendantLaneIdsInTx,
  loadChildLane,
  loadLane,
  setLaneStatusInTx,
  type SwarmLaneRow
} from "./lane-store.js";
import { lockSwarmInTx, startQueuedLanesInTx } from "./scheduler.js";

// A parent acts only on its own direct lanes. Errors are what the model sees.
export class LaneControlError extends Error {}

function isActive(lane: Pick<SwarmLaneRow, "status">): boolean {
  return (ACTIVE_LANE_STATUSES as readonly string[]).includes(lane.status);
}

async function loadOwnLaneInTx(client: PoolClient, swarm: SwarmRunContext, parentTaskId: string, laneTaskId: string): Promise<SwarmLaneRow> {
  await lockSwarmInTx(client, swarm.swarmTaskId);
  await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [parentTaskId]);
  const lane = await loadChildLane(client, parentTaskId, laneTaskId);
  if (!lane) throw new LaneControlError("That is not one of your lanes.");
  return lane;
}

export async function steerLane(input: { swarm: SwarmRunContext; parentTaskId: string; laneTaskId: string; message: string }): Promise<void> {
  await withTransaction(async (client) => {
    const lane = await loadOwnLaneInTx(client, input.swarm, input.parentTaskId, input.laneTaskId);
    if (lane.status === "done") throw new LaneControlError("This lane has submitted. Use resume to continue it.");
    if (!isActive(lane)) throw new LaneControlError("This lane has ended.");
    await insertLaneInboxInTx(client, { laneTaskId: lane.task_id, swarmTaskId: lane.swarm_task_id, kind: "steer", body: input.message });
  });
}

// A lane that never started has nothing to submit, so it ends straight away.
async function endQueuedLaneInTx(client: PoolClient, laneTaskId: string, summary: string): Promise<void> {
  await client.query(
    `UPDATE tasks SET status = 'cancelled', cancellation_requested = true, completed_at = now(), updated_at = now()
      WHERE id = $1`,
    [laneTaskId]
  );
  await setLaneStatusInTx(client, laneTaskId, "stopped", { result: buildUnsubmittedLaneResult(summary) });
}

// Running lanes submit what they have at their next step; their parents then resume as usual.
async function requestForcedSubmitInTx(client: PoolClient, lane: SwarmLaneRow): Promise<void> {
  if (lane.status === "queued") {
    await endQueuedLaneInTx(client, lane.task_id, "Stopped before it started.");
    return;
  }
  await insertLaneInboxInTx(client, { laneTaskId: lane.task_id, swarmTaskId: lane.swarm_task_id, kind: "stop", body: "" });
}

// Discarded lanes are cancelled through the task's cancellation flag, which aborts an in-flight run;
// lanes with no run end here. Their failure path marks running ones stopped.
async function cancelLaneInTx(client: PoolClient, lane: SwarmLaneRow): Promise<void> {
  if (lane.status === "running") {
    await client.query(
      "UPDATE tasks SET cancellation_requested = true, resume_after_interrupt = false, updated_at = now() WHERE id = $1",
      [lane.task_id]
    );
    return;
  }
  await endQueuedLaneInTx(client, lane.task_id, "Stopped and discarded.");
  await client.query("DELETE FROM task_swarm_parks WHERE task_id = $1", [lane.task_id]);
  await dropDiscardedResultInTx(client, lane);
}

// Stopping a lane stops its sub-lanes too, deepest first, so a waiting lane wakes to its own stop.
export async function stopLane(input: {
  swarm: SwarmRunContext;
  parentTaskId: string;
  laneTaskId: string;
  discard: boolean;
}): Promise<void> {
  await withTransaction(async (client) => {
    const lane = await loadOwnLaneInTx(client, input.swarm, input.parentTaskId, input.laneTaskId);
    if (!isActive(lane)) throw new LaneControlError("This lane has already finished.");
    const descendantIds = await listDescendantLaneIdsInTx(client, lane.task_id);
    const targets = [lane];
    for (const id of descendantIds) {
      const descendant = await loadLane(client, id);
      if (descendant && isActive(descendant)) targets.push(descendant);
    }
    for (const target of targets.reverse()) {
      if (input.discard) await cancelLaneInTx(client, target);
      else await requestForcedSubmitInTx(client, target);
    }
    await startQueuedLanesInTx(client, input.swarm.swarmTaskId, input.swarm.settings.advanced.maxRunningLanes);
    for (const target of targets) {
      await wakeParentIfBarrierMetInTx(client, target.parent_task_id);
    }
  });
}

// Continues a dormant lane with its full context: the message reaches it through its inbox when its
// next run starts. The caller parks until it submits again.
export async function resumeLane(input: {
  swarm: SwarmRunContext;
  parentTaskId: string;
  laneTaskId: string;
  message: string;
  // Applied in the same transaction, for budgets; may throw a LaneControlError.
  addShare?: (client: PoolClient, lane: SwarmLaneRow) => Promise<void>;
}): Promise<SwarmLaneRow> {
  return withTransaction(async (client) => {
    const lane = await loadOwnLaneInTx(client, input.swarm, input.parentTaskId, input.laneTaskId);
    if (isActive(lane)) throw new LaneControlError("This lane is still working. Use steer to send it a message.");
    if (!await isLaneResumableInTx(client, lane, input.swarm.settings.advanced.dormantLaneTurns)) {
      throw new LaneControlError("This lane can no longer be resumed. Split a new lane instead.");
    }
    await input.addShare?.(client, lane);
    await insertLaneInboxInTx(client, { laneTaskId: lane.task_id, swarmTaskId: lane.swarm_task_id, kind: "resume", body: input.message });
    await setLaneStatusInTx(client, lane.task_id, "queued");
    await client.query("UPDATE tasks SET status = 'queued', completed_at = NULL, updated_at = now() WHERE id = $1", [lane.task_id]);
    await startQueuedLanesInTx(client, input.swarm.swarmTaskId, input.swarm.settings.advanced.maxRunningLanes);
    return lane;
  });
}
