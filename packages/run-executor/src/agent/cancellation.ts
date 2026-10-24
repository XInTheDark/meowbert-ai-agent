import type { RunControl } from "./ports/run-control.js";

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

export function startTaskCancellationMonitor(
  control: RunControl,
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
    const cancellation = await control.readCancellation();
    if (cancellation.cancelRequested) {
      markCancelled("explicit_cancel");
      throw resolveAbortError(controller.signal);
    }
    if (!cancellation.latestAttempt) {
      if (options?.allowNewerAttempt === true) {
        return;
      }
      markCancelled("newer_attempt");
      throw resolveAbortError(controller.signal);
    }
  };

  scheduleDeadlineAbort();
  const stopWatching = control.watchCancellation(markCancelled);

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
