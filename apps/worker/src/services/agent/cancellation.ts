import type { TaskExecutionJob } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import {
  consumeResumeAfterInterrupt,
  enqueueContinuationRun,
  isTaskRunLatestAttempt,
  isCancellationRequested,
  recordRunCompletion,
  resolveContinuationBranchMessageId,
  resolveLatestBranchSelectionUserId,
  setTaskStatusForRun
} from "../agent-db/index.js";
import { resolveContinuationModeForInterruptedTask } from "../task-schedules/service.js";
import { watchRunCancellation } from "./cancellation-batch.js";

export interface TaskCancellationMonitor {
  signal: AbortSignal;
  assertNotCancelled: (options?: {
    allowNewerAttempt?: boolean;
  }) => Promise<void>;
  stop: () => void;
}

type TaskCancellationReason = "explicit_cancel" | "newer_attempt" | "time_limit";

function resolveAbortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) {
    return new Error(reason.message);
  }
  if (typeof reason === "string" && reason.trim().length > 0) {
    return new Error(reason);
  }
  return new Error("TASK_CANCELLED");
}

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

export function startTaskCancellationMonitor(
  taskId: string,
  runId: string,
  options?: {
    timeLimitDeadlineAt?: string | null;
  }
): TaskCancellationMonitor {
  const controller = new AbortController();
  let stopped = false;
  let knownCancelled = false;
  let cancellationReason: TaskCancellationReason | null = null;
  let deadlineTimer: NodeJS.Timeout | null = null;
  const timeLimitDeadlineAtMs =
    typeof options?.timeLimitDeadlineAt === "string" && options.timeLimitDeadlineAt.trim().length > 0
      ? new Date(options.timeLimitDeadlineAt).getTime()
      : null;

  const markCancelled = (reason: TaskCancellationReason): void => {
    if (knownCancelled) {
      return;
    }
    knownCancelled = true;
    cancellationReason = reason;
    if (!controller.signal.aborted) {
      controller.abort(new Error("TASK_CANCELLED"));
    }
  };

  const shouldIgnoreCancellation = (options?: {
    allowNewerAttempt?: boolean;
  }): boolean => {
    return options?.allowNewerAttempt === true && cancellationReason === "newer_attempt";
  };

  const scheduleDeadlineAbort = (): void => {
    if (stopped || knownCancelled || timeLimitDeadlineAtMs === null || !Number.isFinite(timeLimitDeadlineAtMs)) {
      return;
    }

    deadlineTimer = setTimeout(() => {
      markCancelled("time_limit");
    }, Math.max(0, timeLimitDeadlineAtMs - Date.now()));
  };

  const assertNotCancelled = async (options?: {
    allowNewerAttempt?: boolean;
  }): Promise<void> => {
    if ((knownCancelled || controller.signal.aborted) && !shouldIgnoreCancellation(options)) {
      throw resolveAbortError(controller.signal);
    }
    if (timeLimitDeadlineAtMs !== null && Number.isFinite(timeLimitDeadlineAtMs) && Date.now() >= timeLimitDeadlineAtMs) {
      markCancelled("time_limit");
      throw resolveAbortError(controller.signal);
    }
    if (await isCancellationRequested(taskId)) {
      markCancelled("explicit_cancel");
      throw resolveAbortError(controller.signal);
    }
    if (!(await isTaskRunLatestAttempt(taskId, runId))) {
      if (options?.allowNewerAttempt === true) {
        return;
      }
      markCancelled("newer_attempt");
      throw resolveAbortError(controller.signal);
    }
  };

  scheduleDeadlineAbort();
  const stopWatching = watchRunCancellation(taskId, runId, markCancelled);

  return {
    signal: controller.signal,
    assertNotCancelled,
    stop: () => {
      stopped = true;
      stopWatching();
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
    }
  };
}
