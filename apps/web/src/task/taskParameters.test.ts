import { describe, expect, it } from "vitest";
import {
  buildCreateTaskParametersPayload,
  buildDefaultTaskParameters,
  buildTaskParametersFromTask,
  buildTaskSchedulePayload,
  normalizeTaskParameters,
  taskScheduleMatches
} from "./taskParameters";

describe("buildTaskParametersFromTask", () => {
  it("maps timed schedules from task detail payloads", () => {
    expect(
      buildTaskParametersFromTask({
        taskType: "timed",
        maxStepsOverride: 12,
        schedule: {
          repeat: null,
          timezone: "UTC",
          run_timeout_seconds: 1800,
          run_deadline_at: "2026-03-12T08:35:00.000Z"
        }
      })
    ).toEqual({
      schedule: {
        type: "timed",
        repeat: null,
        timezone: "UTC",
        timeLimitSeconds: 1800,
        deadlineAt: "2026-03-12T08:35:00.000Z"
      },
      maxSteps: 12,
      timeLimitSeconds: null,
      allowWaiting: true
    });
  });

  it("preserves waiting preferences from task detail payloads", () => {
    expect(buildTaskParametersFromTask({
      maxStepsOverride: 8,
      allowWaiting: false
    })).toEqual({
      ...buildDefaultTaskParameters(),
      maxSteps: 8,
      allowWaiting: false
    });
  });
});

describe("taskScheduleMatches", () => {
  it("treats matching schedule settings as equal even if deadlines differ", () => {
    expect(taskScheduleMatches(
      {
        type: "timed",
        repeat: null,
        timezone: "UTC",
        timeLimitSeconds: 1800,
        deadlineAt: "2026-03-12T08:35:00.000Z"
      },
      {
        type: "timed",
        repeat: null,
        timezone: "UTC",
        timeLimitSeconds: 1800,
        deadlineAt: "2026-03-12T09:05:00.000Z"
      }
    )).toBe(true);
  });

  it("detects schedule changes that must be persisted", () => {
    expect(taskScheduleMatches(
      {
        type: "standard",
        repeat: null,
        timezone: null,
        timeLimitSeconds: null,
        deadlineAt: null
      },
      {
        type: "scheduled",
        repeat: "0 * * * *",
        timezone: "UTC",
        timeLimitSeconds: null,
        deadlineAt: null
      }
    )).toBe(false);
  });
});

describe("buildTaskSchedulePayload", () => {
  it("omits deadline metadata from timed task payloads", () => {
    expect(buildTaskSchedulePayload({
      type: "timed",
      repeat: null,
      timezone: "UTC",
      timeLimitSeconds: 1800,
      deadlineAt: "2026-03-12T08:35:00.000Z"
    })).toEqual({
      type: "timed",
      timezone: "UTC",
      timeLimitSeconds: 1800
    });
  });
});

describe("task parameter defaults", () => {
  it("defaults allowWaiting to true", () => {
    expect(buildDefaultTaskParameters().allowWaiting).toBe(true);
    expect(normalizeTaskParameters({ maxSteps: 5 }).allowWaiting).toBe(true);
  });

  it("only sends non-default task parameter values on create", () => {
    expect(buildCreateTaskParametersPayload(buildDefaultTaskParameters())).toBeUndefined();
    expect(buildCreateTaskParametersPayload({
      ...buildDefaultTaskParameters(),
      allowWaiting: false
    })).toEqual({
      allowWaiting: false
    });
  });
});
