import { withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import type { StoredSwarmPause } from "./agent-swarm-dependencies.js";
import { lockSwarmWorkflowInTx, saveSwarmPauseInTx } from "./agent-swarm-pause-store.js";
import { enqueueWorkflowTaskRun, getSwarmToolOptionsOverride } from "./shared.js";

export interface SwarmWake extends StoredSwarmPause {
  taskId: string;
}

export async function emitSwarmActivityEvent(workflowTaskId: string, taskId: string, message: string): Promise<void> {
  await emitTaskEvent(taskId, "log", { message });
  if (taskId !== workflowTaskId) {
    await emitTaskEvent(workflowTaskId, "log", { message });
  }
}

export async function restoreSwarmPause(
  workflowTaskId: string,
  taskId: string,
  pause: StoredSwarmPause
): Promise<void> {
  await withTransaction(async (client) => {
    if ((await lockSwarmWorkflowInTx(client, workflowTaskId)).completed) return;
    await saveSwarmPauseInTx(client, workflowTaskId, taskId, pause);
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
