import { normalizeAgentSwarmSettings, type TaskExecutionJob } from "@meowbert/shared";
import { pool, withTransaction } from "../../lib/db.js";
import { wakeParentIfBarrierMetInTx } from "./barrier.js";
import { buildUnsubmittedLaneResult } from "@meowbert/run-executor/agent-swarm/forced-submit";
import { finishLaneRun } from "./lane-completion.js";
import { dropDiscardedResultInTx, loadLane, setLaneStatusInTx } from "./lane-store.js";
import { lockSwarmInTx, startQueuedLanesInTx } from "./scheduler.js";

async function loadMaxRunningLanes(swarmTaskId: string): Promise<number> {
  const config = (await pool.query<{ config_json: unknown }>("SELECT config_json FROM task_swarms WHERE task_id = $1", [swarmTaskId])).rows[0];
  return normalizeAgentSwarmSettings(config?.config_json).advanced.maxRunningLanes;
}

// Ends a still-active lane as failed, so its parent's barrier completes.
export async function failActiveLane(laneTaskId: string, runId: string, errorMessage: string): Promise<void> {
  const lane = await loadLane(pool, laneTaskId);
  if (!lane || !["running", "waiting"].includes(lane.status)) return;
  await finishLaneRun({
    lane,
    runId,
    status: "failed",
    result: buildUnsubmittedLaneResult(`The lane failed: ${errorMessage}`),
    maxRunningLanes: await loadMaxRunningLanes(lane.swarm_task_id),
    errorSummary: errorMessage
  });
}

// A lane run that fails for good still ends the lane, so its parent's barrier completes.
export async function finishFailedLaneRun(job: TaskExecutionJob, errorMessage: string, cancelled: boolean): Promise<void> {
  if (job.mode !== "agent_swarm_lane") return;
  if (!cancelled) {
    await failActiveLane(job.taskId, job.runId, errorMessage);
    return;
  }
  const lane = await loadLane(pool, job.taskId);
  if (!lane || !["running", "waiting"].includes(lane.status)) return;
  const maxRunningLanes = await loadMaxRunningLanes(lane.swarm_task_id);
  await withTransaction(async (client) => {
    await lockSwarmInTx(client, lane.swarm_task_id);
    await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [lane.parent_task_id]);
    // An interrupt that resumes the lane is not a stop.
    const task = await client.query<{ status: string }>("SELECT status FROM tasks WHERE id = $1 FOR UPDATE", [lane.task_id]);
    if (task.rows[0]?.status !== "cancelled") return;
    await setLaneStatusInTx(client, lane.task_id, "stopped", { result: buildUnsubmittedLaneResult("Stopped and discarded.") });
    await dropDiscardedResultInTx(client, lane);
    await startQueuedLanesInTx(client, lane.swarm_task_id, maxRunningLanes);
    await wakeParentIfBarrierMetInTx(client, lane.parent_task_id);
  });
}
