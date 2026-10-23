import { withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import { wakeParentIfBarrierMetInTx } from "./barrier.js";
import { setLaneStatusInTx, type SwarmLaneResult, type SwarmLaneRow } from "./lane-store.js";
import { lockSwarmInTx, startQueuedLanesInTx } from "./scheduler.js";

// Ends a lane run with its result in one transaction: the run, the lane task, the lane row, the next
// queued lane and the parent's barrier all move together, so a crash never strands a parent.
export async function finishLaneRun(input: {
  lane: Pick<SwarmLaneRow, "task_id" | "swarm_task_id" | "parent_task_id">;
  runId: string;
  status: "done" | "failed";
  result: SwarmLaneResult;
  maxRunningLanes: number;
  errorSummary?: string;
}): Promise<{ parentWoken: boolean }> {
  const { lane } = input;
  const outcome = await withTransaction(async (client) => {
    await lockSwarmInTx(client, lane.swarm_task_id);
    await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [lane.parent_task_id]);
    await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [lane.task_id]);
    await client.query(
      `UPDATE task_runs SET ended_at = now(), exit_reason = $2, error_summary = $3, notification_requested = false
        WHERE id = $1 AND ended_at IS NULL`,
      [input.runId, input.status === "done" ? "completed" : "error", input.errorSummary ?? null]
    );
    await client.query(
      "UPDATE task_run_dispatches SET queue_state = 'finished', finished_at = now(), updated_at = now() WHERE run_id = $1",
      [input.runId]
    );
    const taskStatus = input.status === "done" ? "succeeded" : "failed";
    await client.query(
      "UPDATE tasks SET status = $2, completed_at = now(), updated_at = now() WHERE id = $1 AND NOT cancellation_requested",
      [lane.task_id, taskStatus]
    );
    await setLaneStatusInTx(client, lane.task_id, input.status, { result: input.result });
    // Outcome logging: how much a Check lane found.
    if (input.result.findings) {
      await client.query("UPDATE task_swarm_lanes SET check_findings = $2 WHERE task_id = $1", [lane.task_id, input.result.findings.length]);
    }
    await startQueuedLanesInTx(client, lane.swarm_task_id, input.maxRunningLanes);
    return { taskStatus, parentWoken: await wakeParentIfBarrierMetInTx(client, lane.parent_task_id) };
  });
  await emitTaskEvent(lane.task_id, "status", { status: outcome.taskStatus });
  await emitTaskEvent(lane.swarm_task_id, "log", {
    message: `Lane ${input.status === "done" ? "submitted" : "failed"}.`,
    phase: "swarm_lane",
    laneId: lane.task_id,
    status: input.status
  });
  return { parentWoken: outcome.parentWoken };
}
