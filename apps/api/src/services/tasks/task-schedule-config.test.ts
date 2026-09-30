import { describe, expect, it } from "vitest";
import { resolveTaskScheduleConfig } from "./task-schedule-config.js";

describe("resolveTaskScheduleConfig", () => {
  it("returns null for standard tasks", () => {
    expect(resolveTaskScheduleConfig({
      type: "standard",
      repeat: null,
      timezone: null,
      timeLimitSeconds: null
    })).toBeNull();
  });

  it("normalizes scheduled tasks and computes the next run", () => {
    const result = resolveTaskScheduleConfig(
      {
        type: "scheduled",
        repeat: "*/15   * * * *",
        timezone: "Asia/Singapore",
        timeLimitSeconds: null
      },
      {
        defaultTimezone: "UTC",
        now: new Date("2026-03-12T08:05:00.000Z")
      }
    );

    expect(result).toMatchObject({
      mode: "scheduled",
      repeat: "*/15 * * * *",
      timezone: "Asia/Singapore",
      runTimeoutSeconds: null,
      runDeadlineAt: null
    });
    expect(result?.nextRunAt).toBe("2026-03-12T08:15:00.000Z");
  });

  it("builds timed tasks with a deadline from now", () => {
    const result = resolveTaskScheduleConfig(
      {
        type: "timed",
        repeat: null,
        timezone: null,
        timeLimitSeconds: 1800
      },
      {
        defaultTimezone: "UTC",
        now: new Date("2026-03-12T08:05:00.000Z")
      }
    );

    expect(result).toEqual({
      mode: "infinite",
      repeat: null,
      timezone: "UTC",
      nextRunAt: null,
      runTimeoutSeconds: 1800,
      runDeadlineAt: "2026-03-12T08:35:00.000Z"
    });
  });

  it("rejects timed tasks without a time limit", () => {
    expect(() => resolveTaskScheduleConfig({
      type: "timed",
      repeat: null,
      timezone: "UTC",
      timeLimitSeconds: null
    })).toThrow("timeLimitSeconds is required for timed mode");
  });
});
