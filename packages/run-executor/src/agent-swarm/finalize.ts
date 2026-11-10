import type { AgentExecutionContext } from "../agent/execution-types.js";
import type { SwarmBackend, SwarmRunRef } from "./backend.js";
import { buildUnsubmittedLaneResult } from "./forced-submit.js";
import type { SwarmParkReason } from "./lane-types.js";

type AppendAssistantMessage = (text: string) => Promise<void>;

// Parking ends the run: the backend also reports the task as waiting for its lanes.
async function park(execution: AgentExecutionContext, backend: SwarmBackend, run: SwarmRunRef, reason: SwarmParkReason): Promise<void> {
  const leafMessageId = execution.state.currentLeafMessageId;
  await backend.park(run, { job: { ...execution.job, branchMessageId: leafMessageId ?? undefined }, leafMessageId, reason });
}

// Handles how a swarm run ends, when it ends differently from an ordinary run. Returns false when the
// ordinary finalization should go on (a leader with no lanes left to wait for).
export async function finalizeSwarmRun(
  execution: AgentExecutionContext,
  backend: SwarmBackend,
  appendAssistantMessage: AppendAssistantMessage
): Promise<boolean> {
  const swarm = execution.swarm;
  if (!swarm) return false;
  const run = { taskId: execution.job.taskId, swarm };
  const dispatch = execution.state.dispatchState;
  if (dispatch.swarmPark) {
    await appendAssistantMessage("");
    await park(execution, backend, run, dispatch.swarmPark.reason);
    return true;
  }
  if (swarm.lane) {
    const submitted = dispatch.swarmSubmit;
    await appendAssistantMessage(submitted?.summary ?? "");
    await backend.finishLane(run, {
      runId: execution.job.runId,
      status: submitted ? "done" : "failed",
      result: submitted ?? buildUnsubmittedLaneResult(execution.runTiming.reachedMaxRunSteps
        ? "The lane reached its step limit without submitting."
        : "The lane stopped before submitting.")
    });
    return true;
  }
  return false;
}

// A leader reply while lanes still run (the user wrote in the meantime) is delivered as a normal
// message, then the leader parks again instead of finishing.
export async function parkLeaderIfLanesActive(execution: AgentExecutionContext, backend: SwarmBackend): Promise<boolean> {
  const swarm = execution.swarm;
  if (!swarm || swarm.lane) return false;
  const run = { taskId: execution.job.taskId, swarm };
  if (!await backend.hasActiveLanes(run)) return false;
  await park(execution, backend, run, "lanes");
  return true;
}
