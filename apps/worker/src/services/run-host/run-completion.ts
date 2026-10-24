import { recordRunCompletion, setTaskStatusForRun } from "../agent-db/index.js";
import { completeTaskRun } from "../tasks/complete-task-run.js";
import { wakeRunDeliveryLoop } from "../notifications/run-delivery-loop.js";
import { pauseInfiniteScheduleAfterCheckin, pauseTimedScheduleAfterCompletion } from "../task-schedules/service.js";
import {
  syncFinishedMemorySynthesisRequests,
  triggerAutomaticMemorySynthesis
} from "../memory-synthesis/service.js";
import type { RunCompletion, RunCompletionResult } from "@meowbert/run-executor/agent/ports/run-control";
import type { ServerRunState } from "./bootstrap.js";

async function completeSucceededRun(
  run: ServerRunState,
  completion: Extract<RunCompletion, { kind: "succeeded" }>
): Promise<RunCompletionResult> {
  const { job, snapshot } = run;
  const updatedStatus = await completeTaskRun({
    taskId: job.taskId,
    runId: job.runId,
    finalResponse: completion.finalResponse,
    notificationRequested: completion.notificationRequested,
    isSubtask: snapshot.task.parent_task_id !== null,
    connectorContextId: snapshot.task.connector_context_id,
    workspaceId: snapshot.task.workspace_id,
    environmentId: snapshot.task.environment_id,
    taskTitle: snapshot.task.title,
    targetUserId: job.selectionUserId ?? snapshot.task.initiator_user_id ?? null
  });
  if (!updatedStatus) return { updatedStatus };
  wakeRunDeliveryLoop();

  if (completion.pauseTimedSchedule) {
    await pauseTimedScheduleAfterCompletion(job.taskId);
  }
  if (job.mode === "infinite_checkin") {
    await pauseInfiniteScheduleAfterCheckin(job.taskId);
  }

  if (job.mode === "memory_synthesis") {
    void syncFinishedMemorySynthesisRequests().catch((error) => {
      console.error("Unable to finalize memory synthesis request", error);
    });
    return { updatedStatus };
  }

  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    void triggerAutomaticMemorySynthesis({
      workspaceId: snapshot.task.workspace_id,
      environmentId: snapshot.task.environment_id
    }).catch((error) => {
      console.error("Unable to evaluate automatic Memory refresh", error);
    });
  }
  return { updatedStatus };
}

// Ends a run whose agent loop finished; completion and pending delivery commit together.
export async function completeServerRun(run: ServerRunState, completion: RunCompletion): Promise<RunCompletionResult> {
  if (completion.kind === "succeeded") {
    return completeSucceededRun(run, completion);
  }
  if (completion.kind === "status") {
    const updatedStatus = await setTaskStatusForRun(run.job.taskId, run.job.runId, completion.status);
    await recordRunCompletion(run.job.runId, "completed", undefined, completion.notificationRequested);
    return { updatedStatus };
  }
  await recordRunCompletion(run.job.runId, "completed", undefined, false);
  return { updatedStatus: false };
}
