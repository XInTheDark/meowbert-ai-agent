import { randomUUID } from "node:crypto";
import { buildTaskRunQueueJobId, type TaskExecutionJob, type TaskExecutionTarget } from "@meowbert/shared";
import { withTransaction, query } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { emitTaskEvent } from "../runtime/events.js";
import { insertTaskRunDispatchWithClient, markTaskRunDispatchFinished } from "../tasks/task-run-dispatch.js";

export async function recordRunCompletion(
  runId: string,
  exitReason: string,
  errorSummary?: string,
  notificationRequested?: boolean
): Promise<void> {
  await query(
    `UPDATE task_runs
        SET ended_at = now(),
            exit_reason = $2,
            error_summary = $3,
            notification_requested = COALESCE($4, notification_requested)
      WHERE id = $1`,
    [runId, exitReason, errorSummary ?? null, notificationRequested ?? null]
  );
  await markTaskRunDispatchFinished(runId, exitReason === "cancelled" ? "cancelled" : "finished");
}

export async function isTaskRunLatestAttempt(taskId: string, runId: string): Promise<boolean> {
  const result = await query<{ is_latest: boolean }>(
    `SELECT NOT EXISTS (
        SELECT 1
          FROM task_runs newer
         WHERE newer.task_id = current_run.task_id
           AND newer.attempt_no > current_run.attempt_no
      ) AS is_latest
       FROM task_runs current_run
      WHERE current_run.task_id = $1
        AND current_run.id = $2
        AND current_run.ended_at IS NULL`,
    [taskId, runId]
  );

  return result.rows[0]?.is_latest === true;
}

export async function consumeCommandInterruptForStep(runId: string, step: number): Promise<boolean> {
  const currentRes = await query<{ interrupt_command_step: number | null }>(
    `SELECT interrupt_command_step
       FROM task_runs
      WHERE id = $1`,
    [runId]
  );
  if ((currentRes.rowCount ?? 0) === 0) {
    return false;
  }

  const requestedStep = currentRes.rows[0].interrupt_command_step;
  if (requestedStep === null) {
    return false;
  }

  if (requestedStep <= step) {
    await query(
      `UPDATE task_runs
          SET interrupt_command_step = NULL
        WHERE id = $1`,
      [runId]
    );
  }

  return requestedStep === step;
}

async function allocateContinuationRun(job: TaskExecutionJob, payload: TaskExecutionJob): Promise<number> {
  return withTransaction(async (client) => {
    const taskLockRes = await client.query<{ id: string; execution_target?: TaskExecutionTarget; initiator_user_id: string | null }>(
      `SELECT id, execution_target, initiator_user_id
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [job.taskId]
    );
    if ((taskLockRes.rowCount ?? 0) === 0) {
      throw new Error(`Task not found: ${job.taskId}`);
    }
    payload.executionTarget = taskLockRes.rows[0].execution_target ?? job.executionTarget;

    const attemptRes = await client.query<{ attempt_no: number }>(
      `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
         FROM task_runs
        WHERE task_id = $1`,
      [job.taskId]
    );
    const nextAttemptNo = attemptRes.rows[0].attempt_no;

    await client.query(
      `INSERT INTO task_runs (id, task_id, attempt_no, run_kind)
       VALUES ($1, $2, $3, $4)`,
      [payload.runId, job.taskId, nextAttemptNo, payload.mode]
    );

    await client.query(
      `UPDATE tasks
          SET status = 'queued',
              cancellation_requested = false,
              resume_after_interrupt = false,
              completed_at = NULL,
              trashed_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [job.taskId]
    );

    if (payload.executionTarget?.kind === "local") {
      await insertTaskRunDispatchWithClient(client, {
        runId: payload.runId, taskId: job.taskId, workspaceId: job.workspaceId, environmentId: job.environmentId,
        payload, dispatchCategory: "followup",
        priorityActorUserId: payload.selectionUserId ?? taskLockRes.rows[0].initiator_user_id
      });
    }
    return nextAttemptNo;
  });
}

function resolveContinuationToolOptions(
  job: TaskExecutionJob,
  overrides: {
    toolOptionsOverride?: TaskExecutionJob["toolOptionsOverride"] | null;
  }
): TaskExecutionJob["toolOptionsOverride"] | undefined {
  const hasToolOptionsOverride = Object.prototype.hasOwnProperty.call(overrides, "toolOptionsOverride");
  return hasToolOptionsOverride
    ? overrides.toolOptionsOverride ?? undefined
    : job.toolOptionsOverride;
}

async function enqueueContinuationJob(jobId: string, payload: TaskExecutionJob): Promise<void> {
  if (payload.executionTarget?.kind === "local") return;
  await taskQueue.add(
    jobId,
    payload,
    {
      jobId,
      attempts: 1,
      removeOnComplete: 200,
      removeOnFail: 200
    }
  );
}

export async function enqueueContinuationRun(
  job: TaskExecutionJob,
  overrides: {
    branchMessageId?: string | null;
    selectionUserId?: string | null;
    mode?: TaskExecutionJob["mode"];
    toolOptionsOverride?: TaskExecutionJob["toolOptionsOverride"] | null;
  } = {}
): Promise<{ runId: string; attemptNo: number }> {
  const runId = randomUUID();
  const jobId = buildTaskRunQueueJobId(job.taskId, runId);
  const runMode = overrides.mode ?? job.mode ?? "default";
  const payload: TaskExecutionJob = {
    taskId: job.taskId, workspaceId: job.workspaceId, environmentId: job.environmentId, triggerSource: job.triggerSource,
    runId, mode: runMode,
    branchMessageId: overrides.branchMessageId ?? job.branchMessageId,
    selectionUserId: overrides.selectionUserId ?? job.selectionUserId,
    toolOptionsOverride: resolveContinuationToolOptions(job, overrides)
  };
  const attemptNo = await allocateContinuationRun(job, payload);

  await enqueueContinuationJob(jobId, payload);
  await emitTaskEvent(job.taskId, "status", { status: "queued" });

  return { runId, attemptNo };
}
