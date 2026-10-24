import type { TaskExecutionJob } from "@meowbert/shared";

export const DEFAULT_INFINITE_AUTO_WAIT_SECONDS = 300;

export function shouldExposeStopTaskForRecurringRun(input: {
  hasSchedule: boolean;
  scheduleState: "active" | "paused" | "cancelled" | null;
  isTimedInfiniteRun: boolean;
}): boolean {
  return input.hasSchedule && input.scheduleState !== "cancelled" && !input.isTimedInfiniteRun;
}

export function shouldAutoApplyInfiniteWait(input: {
  runMode?: TaskExecutionJob["mode"];
  hasWaitRequest: boolean;
  hasStopRequest: boolean;
  timedRunFinalizing: boolean;
}): boolean {
  return input.runMode === "infinite_auto"
    && !input.hasWaitRequest
    && !input.hasStopRequest
    && !input.timedRunFinalizing;
}

export function shouldPauseTimedScheduleAfterCompletion(input: {
  isTimedInfiniteRun: boolean;
  timedRunFinalizing: boolean;
  hasWaitRequest: boolean;
  hasStopRequest: boolean;
}): boolean {
  return input.isTimedInfiniteRun
    && input.timedRunFinalizing
    && !input.hasWaitRequest
    && !input.hasStopRequest;
}

export function buildTimedRunFinalizationMessage(): string {
  return "[System: The timed task's time limit has ended. Stop the loop now and call final_response with your final answer.]";
}
