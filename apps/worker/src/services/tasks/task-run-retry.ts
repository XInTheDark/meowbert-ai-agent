import { randomUUID } from "node:crypto";
import {
  buildTaskRunQueueJobId,
  type TaskExecutionJob,
  type TaskRunDispatchClass,
  type TaskStatus
} from "@meowbert/shared";
import { withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { emitTaskEvent } from "../runtime/events.js";
import { insertTaskRunDispatchWithClient } from "./task-run-dispatch.js";

const RETRY_ELIGIBLE_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "queued",
  "starting",
  "running",
  "awaiting_input"
]);

const NON_RETRYABLE_ERROR_PATTERNS: readonly RegExp[] = [
  /^TASK_CANCELLED$/,
  /^RUN_TIME_LIMIT_REACHED$/,
  /^Task not found:/,
  /^Subtask not found:/,
  /^Skill not found:/,
  /^Skills are not configured\b/,
  /^BYO provider is enabled but configuration is incomplete\.$/,
  /^Google Drive could not authorize the live folder\./,
  /^The attached Google Drive folder no longer exists\b/
];

export interface TaskRunRetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_TASK_RUN_RETRY_POLICY: TaskRunRetryPolicy = {
  baseDelayMs: 5_000,
  maxDelayMs: 15 * 60_000
};

export interface TaskRunRetryPlan {
  retrying: boolean;
  delayMs: number;
  cappedDelayMs: number;
  policy: TaskRunRetryPolicy;
}

interface RetryableRunRow {
  task_id: string;
  attempt_no: number;
  run_kind: TaskExecutionJob["mode"] | null;
  ended_at: string | null;
  retry_series_started_at: string;
  retry_sequence_no: number;
  max_task_run_retries: number;
}

interface RetryableDispatchRow {
  dispatch_class: TaskRunDispatchClass;
  priority_actor_user_id: string | null;
  priority_actor_is_super_admin: boolean;
}

type ScheduleTaskRunRetryResult =
  | {
    status: "scheduled";
    errorMessage: string;
    retryNotice: string;
    delayMs: number;
    nextRunId: string;
    nextAttemptNo: number;
    retrySequenceNo: number;
    retrySeriesStartedAt: string;
    runMode: TaskExecutionJob["mode"];
    payload: TaskExecutionJob;
    schedulerManaged: boolean;
    queueAddError?: string;
  }
  | {
    status: "exhausted" | "non_retryable";
    errorMessage: string;
  }
  | {
    status: "noop";
    errorMessage: string;
  };

function toFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  const text = String(error ?? "Unknown worker error").trim();
  return text.length > 0 ? text : "Unknown worker error";
}

export function calculateTaskRunRetryDelayMs(
  retrySequenceNo: number,
  policy: TaskRunRetryPolicy = DEFAULT_TASK_RUN_RETRY_POLICY
): number {
  const safeExponent = Math.max(0, Math.min(30, retrySequenceNo - 1));
  const rawDelayMs = policy.baseDelayMs * Math.pow(2, safeExponent);
  if (!Number.isFinite(rawDelayMs)) {
    return policy.maxDelayMs;
  }

  return Math.min(rawDelayMs, policy.maxDelayMs);
}

export function planTaskRunRetry(input: {
  retrySequenceNo: number;
  maxRetries: number;
  policy?: TaskRunRetryPolicy;
}): TaskRunRetryPlan {
  const policy = input.policy ?? DEFAULT_TASK_RUN_RETRY_POLICY;
  const cappedDelayMs = calculateTaskRunRetryDelayMs(input.retrySequenceNo, policy);

  if (input.retrySequenceNo > input.maxRetries) {
    return {
      retrying: false,
      delayMs: 0,
      cappedDelayMs,
      policy
    };
  }

  return {
    retrying: true,
    delayMs: cappedDelayMs,
    cappedDelayMs,
    policy
  };
}

function isRetryableTaskRunErrorMessage(message: string): boolean {
  return !NON_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function formatRetryDelay(delayMs: number): string {
  if (delayMs <= 0) {
    return "now";
  }

  const totalSeconds = Math.ceil(delayMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.ceil(totalMinutes / 60);
  if (totalHours < 48) {
    return `${totalHours}h`;
  }

  return `${Math.ceil(totalHours / 24)}d`;
}

export function buildTaskRunRetryNotice(input: {
  attemptNo: number;
  errorMessage: string;
  delayMs: number;
}): string {
  const errorMessage = input.errorMessage.replace(/\.+$/, "");
  if (input.delayMs <= 0) {
    return `Task run failed (attempt ${input.attemptNo}): ${errorMessage}. Retrying now.`;
  }

  return `Task run failed (attempt ${input.attemptNo}): ${errorMessage}. Retrying in ${formatRetryDelay(input.delayMs)}.`;
}

export async function scheduleTaskRunRetry(input: {
  job: TaskExecutionJob;
  error: unknown;
}): Promise<ScheduleTaskRunRetryResult> {
  const errorMessage = toFailureMessage(input.error);
  if (!isRetryableTaskRunErrorMessage(errorMessage)) {
    return {
      status: "non_retryable",
      errorMessage
    };
  }

  const prepared = await withTransaction(async (client) => {
    const runRes = await client.query<RetryableRunRow>(
      `SELECT task_id,
              attempt_no,
              run_kind,
              ended_at,
              retry_series_started_at,
              retry_sequence_no,
              COALESCE((
                SELECT max_task_run_retries
                  FROM platform_settings
                 WHERE id = 1
              ), 5) AS max_task_run_retries
         FROM task_runs
        WHERE id = $1
        FOR UPDATE`,
      [input.job.runId]
    );

    if ((runRes.rowCount ?? 0) === 0) {
      return { status: "noop", errorMessage } as const;
    }

    const run = runRes.rows[0];
    if (run.task_id !== input.job.taskId || run.ended_at !== null) {
      return { status: "noop", errorMessage } as const;
    }

    const taskRes = await client.query<{ status: TaskStatus }>(
      `SELECT status
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [input.job.taskId]
    );

    if ((taskRes.rowCount ?? 0) === 0) {
      await client.query(
        `UPDATE task_runs
            SET ended_at = now(),
                exit_reason = 'error',
                error_summary = $2
          WHERE id = $1`,
        [input.job.runId, errorMessage]
      );
      return { status: "noop", errorMessage } as const;
    }

    const taskStatus = taskRes.rows[0].status;
    if (!RETRY_ELIGIBLE_TASK_STATUSES.has(taskStatus)) {
      await client.query(
        `UPDATE task_runs
            SET ended_at = now(),
                exit_reason = 'error',
                error_summary = $2
          WHERE id = $1`,
        [input.job.runId, errorMessage]
      );
      return { status: "noop", errorMessage } as const;
    }

    const retryPlan = planTaskRunRetry({
      retrySequenceNo: run.retry_sequence_no,
      maxRetries: run.max_task_run_retries
    });

    if (!retryPlan.retrying) {
      return { status: "exhausted", errorMessage } as const;
    }

    const nextAttemptRes = await client.query<{ attempt_no: number }>(
      `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
         FROM task_runs
        WHERE task_id = $1`,
      [input.job.taskId]
    );
    const nextAttemptNo = nextAttemptRes.rows[0].attempt_no;
    const nextRunId = randomUUID();
    const runMode = run.run_kind ?? input.job.mode ?? "default";
    const nextPayload: TaskExecutionJob = {
      ...input.job,
      runId: nextRunId,
      mode: runMode
    };
    const dispatchRes = await client.query<RetryableDispatchRow>(
      `SELECT dispatch_class,
              priority_actor_user_id,
              priority_actor_is_super_admin
         FROM task_run_dispatches
        WHERE run_id = $1
        FOR UPDATE`,
      [input.job.runId]
    );
    const existingDispatch = dispatchRes.rows[0] ?? null;

    await client.query(
      `UPDATE task_runs
          SET ended_at = now(),
              exit_reason = 'retrying',
              error_summary = $2,
              notification_requested = false
        WHERE id = $1`,
      [input.job.runId, errorMessage]
    );

    await client.query(
      `INSERT INTO task_runs (
        id,
        task_id,
        attempt_no,
        run_kind,
        retry_series_started_at,
        retry_sequence_no
      )
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        nextRunId,
        input.job.taskId,
        nextAttemptNo,
        runMode,
        run.retry_series_started_at,
        run.retry_sequence_no + 1
      ]
    );

    await client.query(
      `UPDATE tasks
          SET status = 'queued',
              cancellation_requested = false,
              resume_after_interrupt = false,
              updated_at = now()
        WHERE id = $1`,
      [input.job.taskId]
    );

    if (existingDispatch) {
      await client.query(
        `UPDATE task_run_dispatches
            SET queue_state = 'finished',
                finished_at = now(),
                updated_at = now()
          WHERE run_id = $1`,
        [input.job.runId]
      );

      await insertTaskRunDispatchWithClient(client, {
        runId: nextRunId,
        taskId: input.job.taskId,
        workspaceId: input.job.workspaceId,
        environmentId: input.job.environmentId,
        payload: nextPayload,
        dispatchClass: existingDispatch.dispatch_class,
        priorityActorUserId: existingDispatch.priority_actor_user_id,
        priorityActorIsSuperAdmin: existingDispatch.priority_actor_is_super_admin,
        eligibleAt: retryPlan.delayMs > 0 ? new Date(Date.now() + retryPlan.delayMs) : new Date()
      });
    }

    return {
      status: "scheduled",
      errorMessage,
      delayMs: retryPlan.delayMs,
      nextRunId,
      nextAttemptNo,
      retrySequenceNo: run.retry_sequence_no + 1,
      retrySeriesStartedAt: run.retry_series_started_at,
      retryNotice: buildTaskRunRetryNotice({
        attemptNo: run.attempt_no,
        errorMessage,
        delayMs: retryPlan.delayMs
      }),
      runMode,
      schedulerManaged: existingDispatch !== null,
      payload: nextPayload
    } as const;
  });

  if (prepared.status !== "scheduled") {
    return prepared;
  }

  const jobId = buildTaskRunQueueJobId(input.job.taskId, prepared.nextRunId);
  let queueAddError: string | undefined;

  if (!prepared.schedulerManaged) {
    try {
      await taskQueue.add(
        jobId,
        prepared.payload,
        {
          jobId,
          attempts: 1,
          delay: prepared.delayMs,
          removeOnComplete: 200,
          removeOnFail: 200
        }
      );
    } catch (error) {
      queueAddError = toFailureMessage(error);
      console.warn(
        `Failed to persist retry job ${jobId}; queued-task recovery will retry it automatically.`,
        error
      );
    }
  }

  await emitTaskEvent(input.job.taskId, "status", { status: "queued" });
  await emitTaskEvent(input.job.taskId, "error", {
    message: prepared.retryNotice,
    retrying: true,
    delayMs: prepared.delayMs,
    nextRunId: prepared.nextRunId,
    nextAttemptNo: prepared.nextAttemptNo,
    retrySequenceNo: prepared.retrySequenceNo,
    retrySeriesStartedAt: prepared.retrySeriesStartedAt,
    queueAddError
  });

  return queueAddError
    ? {
      ...prepared,
      queueAddError
    }
    : prepared;
}
