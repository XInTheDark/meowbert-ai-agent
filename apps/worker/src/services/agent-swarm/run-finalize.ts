import { normalizeAgentSwarmSettings, type TaskExecutionJob } from "@meowbert/shared";
import { pool, withTransaction } from "../../lib/db.js";
import { wakeParentIfBarrierMetInTx } from "./barrier.js";
import { buildUnsubmittedLaneResult } from "@meowbert/run-executor/agent-swarm/forced-submit";
import { finishLaneRun } from "./lane-completion.js";
import { dropDiscardedResultInTx, loadLane, setLaneStatusInTx } from "./lane-store.js";
import { lockSwarmInTx, startQueuedLanesInTx } from "./scheduler.js";

// A lane run that fails for good still ends the lane, so its parent's barrier completes.
export async function finishFailedLaneRun(job: TaskExecutionJob, errorMessage: string, cancelled: boolean): Promise<void> {
  if (job.mode !== "agent_swarm_lane") return;
  const lane = await loadLane(pool, job.taskId);
  if (!lane || !["running", "waiting"].includes(lane.status)) return;
  const config = (await pool.query<{ config_json: unknown }>("SELECT config_json FROM task_swarms WHERE task_id = $1", [lane.swarm_task_id])).rows[0];
  const maxRunningLanes = normalizeAgentSwarmSettings(config?.config_json).advanced.maxRunningLanes;
  if (!cancelled) {
    await finishLaneRun({
      lane,
      runId: job.runId,
      status: "failed",
      result: buildUnsubmittedLaneResult(`The lane failed: ${errorMessage}`),
      maxRunningLanes,
      errorSummary: errorMessage
    });
    return;
  }
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
