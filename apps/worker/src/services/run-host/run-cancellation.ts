import type { TaskExecutionJob } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import {
  consumeResumeAfterInterrupt,
  enqueueContinuationRun,
  isTaskRunLatestAttempt,
  recordRunCompletion,
  resolveContinuationBranchMessageId,
  resolveLatestBranchSelectionUserId,
  setTaskStatusForRun
} from "../agent-db/index.js";
import { resolveContinuationModeForInterruptedTask } from "../task-schedules/service.js";

export async function handleCancelledRun(job: TaskExecutionJob): Promise<void> {
  // An interrupt that resumes must never pass through "cancelled": that status is reported to
  // Project Master listeners, which would treat the still-active task as cancelled.
  const resuming = (await isTaskRunLatestAttempt(job.taskId, job.runId))
    && (await consumeResumeAfterInterrupt(job.taskId));
  if (resuming) {
    await resumeInterruptedRun(job);
    return;
  }

  const updatedStatus = await setTaskStatusForRun(job.taskId, job.runId, "cancelled");
  await recordRunCompletion(job.runId, "cancelled");
  if (updatedStatus) {
    await emitTaskEvent(job.taskId, "log", { message: "Task cancelled." });
  }
}

async function resumeInterruptedRun(job: TaskExecutionJob): Promise<void> {
  try {
    const resumeSelectionUserId = (await resolveLatestBranchSelectionUserId(job.taskId)) ?? job.selectionUserId ?? null;
    const resumeBranchMessageId = await resolveContinuationBranchMessageId(job.taskId, resumeSelectionUserId ?? undefined);
    const resumeMode = await resolveContinuationModeForInterruptedTask(job.taskId, job.mode);
    const continuation = await enqueueContinuationRun(job, {
      mode: resumeMode,
      branchMessageId: resumeBranchMessageId,
      selectionUserId: resumeSelectionUserId,
      toolOptionsOverride: null
    });
    await emitTaskEvent(job.taskId, "log", {
      message: "Task interrupted by a new message. Continuing with latest context.",
      continuationRunId: continuation.runId,
      continuationAttemptNo: continuation.attemptNo,
      branchMessageId: resumeBranchMessageId,
      selectionUserId: resumeSelectionUserId
    });
  } catch (error) {
    await setTaskStatusForRun(job.taskId, job.runId, "cancelled");
    await query(
      `UPDATE tasks
          SET cancellation_requested = false,
              resume_after_interrupt = false,
              updated_at = now()
        WHERE id = $1`,
      [job.taskId]
    );
    const message = error instanceof Error ? error.message : String(error);
    await emitTaskEvent(job.taskId, "error", { message: `Failed to resume interrupted task: ${message}` });
  } finally {
    // Ended only after the continuation exists so a failed resume can still settle this run as cancelled.
    await recordRunCompletion(job.runId, "cancelled");
  }
}
