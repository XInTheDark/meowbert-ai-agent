import { describe, expect, it } from "vitest";
import {
  buildTimedRunFinalizationMessage,
  DEFAULT_INFINITE_AUTO_WAIT_SECONDS,
  shouldAutoApplyInfiniteWait,
  shouldExposeStopTaskForRecurringRun,
  shouldPauseTimedScheduleAfterCompletion
} from "./recurring-run-utils.js";

describe("recurring run helpers", () => {
  it("hides stop_task for timed recurring runs", () => {
    expect(shouldExposeStopTaskForRecurringRun({
      hasSchedule: true,
      scheduleState: "active",
      isTimedInfiniteRun: true
    })).toBe(false);

    expect(shouldExposeStopTaskForRecurringRun({
      hasSchedule: true,
      scheduleState: "active",
      isTimedInfiniteRun: false
    })).toBe(true);
  });

  it("auto-applies fallback waits for unfinished infinite auto cycles before timed finalization", () => {
    expect(shouldAutoApplyInfiniteWait({
      runMode: "infinite_auto",
      hasWaitRequest: false,
      hasStopRequest: false,
      timedRunFinalizing: false
    })).toBe(true);

    expect(shouldAutoApplyInfiniteWait({
      runMode: "infinite_auto",
      hasWaitRequest: false,
      hasStopRequest: false,
      timedRunFinalizing: true
    })).toBe(false);

    expect(DEFAULT_INFINITE_AUTO_WAIT_SECONDS).toBe(300);
  });

  it("only pauses timed schedules after the final wrap-up turn", () => {
    expect(shouldPauseTimedScheduleAfterCompletion({
      isTimedInfiniteRun: true,
      timedRunFinalizing: false,
      hasWaitRequest: false,
      hasStopRequest: false
    })).toBe(false);

    expect(shouldPauseTimedScheduleAfterCompletion({
      isTimedInfiniteRun: true,
      timedRunFinalizing: true,
      hasWaitRequest: false,
      hasStopRequest: false
    })).toBe(true);
  });

  it("builds an explicit timed-run finalization instruction", () => {
    expect(buildTimedRunFinalizationMessage()).toContain("time limit has ended");
    expect(buildTimedRunFinalizationMessage()).toContain("final_response");
  });
});
