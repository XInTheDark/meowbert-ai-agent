import type { TaskParameters, TaskScheduleType, TaskType } from "../lib/types";

export function buildDefaultTaskParameters(): TaskParameters {
  return {
    schedule: {
      type: "standard",
      repeat: null,
      timezone: null,
      timeLimitSeconds: null,
      deadlineAt: null
    },
    maxSteps: null,
    timeLimitSeconds: null,
    allowWaiting: true
  };
}

export function normalizeTaskParameters(value: unknown): TaskParameters {
  const fallback = buildDefaultTaskParameters();
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const candidate = value as {
    schedule?: unknown;
    maxSteps?: unknown;
    timeLimitSeconds?: unknown;
    allowWaiting?: unknown;
  };

  const rawSchedule = candidate.schedule && typeof candidate.schedule === "object"
    ? candidate.schedule as {
      type?: unknown;
      repeat?: unknown;
      timezone?: unknown;
      timeLimitSeconds?: unknown;
      deadlineAt?: unknown;
    }
    : null;

  const scheduleType = rawSchedule?.type;
  const normalizedType: TaskScheduleType =
    scheduleType === "scheduled" || scheduleType === "infinite" || scheduleType === "timed"
      ? scheduleType
      : "standard";

  return {
    schedule: {
      type: normalizedType,
      repeat: typeof rawSchedule?.repeat === "string" && rawSchedule.repeat.trim().length > 0
        ? rawSchedule.repeat.trim()
        : null,
      timezone: typeof rawSchedule?.timezone === "string" && rawSchedule.timezone.trim().length > 0
        ? rawSchedule.timezone.trim()
        : null,
      timeLimitSeconds: typeof rawSchedule?.timeLimitSeconds === "number"
        && Number.isFinite(rawSchedule.timeLimitSeconds)
        && rawSchedule.timeLimitSeconds > 0
        ? Math.floor(rawSchedule.timeLimitSeconds)
        : null,
      deadlineAt: typeof rawSchedule?.deadlineAt === "string" && rawSchedule.deadlineAt.trim().length > 0
        ? rawSchedule.deadlineAt.trim()
        : null
    },
    maxSteps: typeof candidate.maxSteps === "number" && Number.isFinite(candidate.maxSteps) && candidate.maxSteps > 0
      ? Math.floor(candidate.maxSteps)
      : null,
    timeLimitSeconds: typeof candidate.timeLimitSeconds === "number"
      && Number.isFinite(candidate.timeLimitSeconds)
      && candidate.timeLimitSeconds > 0
      ? Math.floor(candidate.timeLimitSeconds)
      : null,
    allowWaiting: candidate.allowWaiting !== false
  };
}

export function hasCustomTaskParameters(taskParameters: TaskParameters): boolean {
  return taskParameters.schedule.type !== "standard"
    || taskParameters.maxSteps !== null
    || taskParameters.timeLimitSeconds !== null
    || taskParameters.allowWaiting === false;
}

export function taskScheduleMatches(left: TaskParameters["schedule"], right: TaskParameters["schedule"]): boolean {
  return left.type === right.type
    && left.repeat === right.repeat
    && left.timezone === right.timezone
    && left.timeLimitSeconds === right.timeLimitSeconds;
}

export function buildTaskSchedulePayload(schedule: TaskParameters["schedule"]): {
  type: TaskScheduleType;
  repeat?: string | null;
  timezone?: string | null;
  timeLimitSeconds?: number | null;
} {
  if (schedule.type === "standard") {
    return {
      type: "standard"
    };
  }

  if (schedule.type === "scheduled") {
    return {
      type: "scheduled",
      repeat: schedule.repeat,
      timezone: schedule.timezone
    };
  }

  if (schedule.type === "timed") {
    return {
      type: "timed",
      timezone: schedule.timezone,
      timeLimitSeconds: schedule.timeLimitSeconds
    };
  }

  return {
    type: "infinite",
    timezone: schedule.timezone
  };
}

export function buildCreateTaskSchedulePayload(taskParameters: TaskParameters): {
  type: Exclude<TaskScheduleType, "standard">;
  repeat?: string | null;
  timezone?: string | null;
  timeLimitSeconds?: number | null;
} | undefined {
  const { schedule } = taskParameters;
  if (schedule.type === "standard") {
    return undefined;
  }

  if (schedule.type === "scheduled") {
    return {
      type: "scheduled",
      repeat: schedule.repeat,
      timezone: schedule.timezone
    };
  }

  if (schedule.type === "timed") {
    return {
      type: "timed",
      timezone: schedule.timezone,
      timeLimitSeconds: schedule.timeLimitSeconds
    };
  }

  return {
    type: "infinite",
    timezone: schedule.timezone
  };
}

export function buildTaskParametersFromTask(input: {
  taskType?: TaskType;
  maxStepsOverride?: number | null;
  timeLimitSeconds?: number | null;
  allowWaiting?: boolean;
  schedule?: {
    repeat?: string | null;
    timezone?: string | null;
    run_timeout_seconds?: number | null;
    run_deadline_at?: string | null;
  } | null;
}): TaskParameters {
  const normalizedTaskType: TaskScheduleType =
    input.taskType === "scheduled" || input.taskType === "infinite" || input.taskType === "timed"
      ? input.taskType
      : "standard";

  return normalizeTaskParameters({
    schedule: {
      type: normalizedTaskType,
      repeat: input.schedule?.repeat ?? null,
      timezone: input.schedule?.timezone ?? null,
      timeLimitSeconds: input.schedule?.run_timeout_seconds ?? null,
      deadlineAt: input.schedule?.run_deadline_at ?? null
    },
    maxSteps: input.maxStepsOverride ?? null,
    timeLimitSeconds: input.timeLimitSeconds ?? null,
    allowWaiting: input.allowWaiting
  });
}

export function buildCreateTaskParametersPayload(taskParameters: TaskParameters): {
  maxSteps?: number;
  timeLimitSeconds?: number;
  allowWaiting?: boolean;
} | undefined {
  const payload: {
    maxSteps?: number;
    timeLimitSeconds?: number;
    allowWaiting?: boolean;
  } = {};

  if (taskParameters.maxSteps !== null) {
    payload.maxSteps = taskParameters.maxSteps;
  }

  if (taskParameters.timeLimitSeconds !== null) {
    payload.timeLimitSeconds = taskParameters.timeLimitSeconds;
  }

  if (taskParameters.allowWaiting === false) {
    payload.allowWaiting = false;
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}
