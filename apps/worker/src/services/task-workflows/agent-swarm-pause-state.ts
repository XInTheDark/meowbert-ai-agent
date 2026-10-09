import { withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import { parseSwarmPauses, type StoredSwarmPause, type StoredSwarmPauseMap } from "./agent-swarm-dependencies.js";
import { asObject, enqueueWorkflowTaskRun, getSwarmToolOptionsOverride } from "./shared.js";

export interface SwarmWake extends StoredSwarmPause {
  taskId: string;
}

export async function emitSwarmActivityEvent(workflowTaskId: string, taskId: string, message: string): Promise<void> {
  await emitTaskEvent(taskId, "log", { message });
  if (taskId !== workflowTaskId) {
    await emitTaskEvent(workflowTaskId, "log", { message });
  }
}

export function buildSwarmState(
  currentState: Record<string, unknown>,
  pausedSwarmAgents: StoredSwarmPauseMap
): Record<string, unknown> {
  const nextState: Record<string, unknown> = {
    ...currentState,
    pausedSwarmAgents
  };
  delete nextState.pendingSwarmWaits;
  delete nextState.lastSwarmStallSignature;
  delete nextState.lastSwarmWaitCycleSignature;
  delete nextState.lastSwarmWaitCycleTaskIds;
  return nextState;
}

export async function restoreSwarmPause(
  workflowTaskId: string,
  taskId: string,
  pause: StoredSwarmPause
): Promise<void> {
  await withTransaction(async (client) => {
    const workflowResult = await client.query<{ phase: string | null; state_json: Record<string, unknown> | null }>(
      `SELECT state_json, phase FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [workflowTaskId]
    );
    if (workflowResult.rows[0]?.phase === "completed") return;
    const currentState = asObject(workflowResult.rows[0]?.state_json);
    const pausedSwarmAgents = parseSwarmPauses(currentState);
    pausedSwarmAgents[taskId] = { ...pause };
    await client.query(
      `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
      [workflowTaskId, JSON.stringify(buildSwarmState(currentState, pausedSwarmAgents))]
    );
  }).catch((error) => {
    console.error(`Failed to restore swarm pause for agent ${taskId}`, error);
  });
}

// Queues runs for agents whose pause was already removed in the database. A failed enqueue puts the
// pause back so the agent is not lost.
export async function enqueueSwarmWakes(
  context: LoadedWorkflowRunContext,
  wakes: SwarmWake[],
  activityMessage: string
): Promise<void> {
  for (const wake of wakes) {
    const { taskId, ...pause } = wake;
    try {
      await enqueueWorkflowTaskRun({
        taskId,
        workspaceId: context.workspaceId,
        environmentId: context.environmentId,
        triggerSource: pause.triggerSource,
        mode: pause.mode,
        selectionUserId: pause.selectionUserId ?? undefined,
        toolOptionsOverride: getSwarmToolOptionsOverride(context)
      });
      await emitSwarmActivityEvent(context.workflowTaskId, taskId, activityMessage);
    } catch (error) {
      console.error(`Failed to enqueue resumed swarm agent ${taskId}`, error);
      await restoreSwarmPause(context.workflowTaskId, taskId, pause);
    }
  }
}
