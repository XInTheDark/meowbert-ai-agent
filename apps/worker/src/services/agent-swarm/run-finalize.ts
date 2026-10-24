import { normalizeAgentSwarmSettings, type TaskExecutionJob } from "@meowbert/shared";
import { pool, withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import type { AgentExecutionContext } from "@meowbert/run-executor/agent/execution-types";
import { wakeParentIfBarrierMetInTx } from "./barrier.js";
import { buildUnsubmittedLaneResult } from "@meowbert/run-executor/agent-swarm/forced-submit";
import { finishLaneRun } from "./lane-completion.js";
import { countActiveChildrenInTx, dropDiscardedResultInTx, loadLane, setLaneStatusInTx } from "./lane-store.js";
import { parkSwarmRun } from "./park.js";
import type { SwarmParkReason } from "@meowbert/run-executor/agent-swarm/lane-types";
import { lockSwarmInTx, startQueuedLanesInTx } from "./scheduler.js";

type AppendAssistantMessage = (text: string) => Promise<void>;

async function park(execution: AgentExecutionContext, reason: SwarmParkReason): Promise<void> {
  const swarm = execution.swarm!;
  await parkSwarmRun({
    job: { ...execution.job, branchMessageId: execution.state.currentLeafMessageId ?? undefined },
    swarmTaskId: swarm.swarmTaskId,
    maxRunningLanes: swarm.settings.advanced.maxRunningLanes,
    reason
  });
  await emitTaskEvent(execution.job.taskId, "status", { status: "queued", waitingForLanes: true });
}

// Handles how a swarm run ends, when it ends differently from an ordinary run. Returns false when the
// ordinary finalization should go on (a leader with no lanes left to wait for).
export async function finalizeSwarmRun(execution: AgentExecutionContext, appendAssistantMessage: AppendAssistantMessage): Promise<boolean> {
  const swarm = execution.swarm;
  if (!swarm) return false;
  const dispatch = execution.state.dispatchState;
  if (dispatch.swarmPark) {
    await appendAssistantMessage("");
    await park(execution, dispatch.swarmPark.reason);
    return true;
  }
  if (swarm.lane) {
    const submitted = dispatch.swarmSubmit;
    await appendAssistantMessage(submitted?.summary ?? "");
    await finishLaneRun({
      lane: swarm.lane,
      runId: execution.job.runId,
      status: submitted ? "done" : "failed",
      result: submitted ?? buildUnsubmittedLaneResult(execution.runTiming.reachedMaxRunSteps
        ? "The lane reached its step limit without submitting."
        : "The lane stopped before submitting."),
      maxRunningLanes: swarm.settings.advanced.maxRunningLanes
    });
    return true;
  }
  return false;
}

// A leader reply while lanes still run (the user wrote in the meantime) is delivered as a normal
// message, then the leader parks again instead of finishing.
export async function parkLeaderIfLanesActive(execution: AgentExecutionContext): Promise<boolean> {
  if (!execution.swarm || execution.swarm.lane) return false;
  if (await countActiveChildrenInTx(pool, execution.job.taskId) === 0) return false;
  await park(execution, "lanes");
  return true;
}

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
