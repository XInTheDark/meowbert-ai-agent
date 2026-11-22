import type { HarnessSettings, HarnessUserPatch } from "@meowbert/shared/harness-settings";
import type { TaskHarnessParameters, TaskParameters, TaskScheduleType, TaskType } from "../lib/types";

const EMPTY_HARNESS_PARAMETERS: TaskHarnessParameters = {
  stopCheckCommand: null,
  tokenBudget: null,
  sandboxKeepWarmMinutes: null
};

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function normalizeHarnessParameters(value: unknown): TaskHarnessParameters {
  if (!value || typeof value !== "object") return EMPTY_HARNESS_PARAMETERS;
  const candidate = value as Record<string, unknown>;
  const command = typeof candidate.stopCheckCommand === "string" ? candidate.stopCheckCommand.trim() : "";
  return {
    stopCheckCommand: command || null,
    tokenBudget: positiveInteger(candidate.tokenBudget),
    sandboxKeepWarmMinutes: positiveInteger(candidate.sandboxKeepWarmMinutes)
  };
}

function hasHarnessParameters(harness: TaskHarnessParameters): boolean {
  return harness.stopCheckCommand !== null || harness.tokenBudget !== null || harness.sandboxKeepWarmMinutes !== null;
}

// The keys the user changed, with null for a cleared one, so settings the agent set stay its own.
export function buildHarnessPatch(previous: TaskHarnessParameters, next: TaskHarnessParameters): HarnessUserPatch | undefined {
  const patch: HarnessUserPatch = {};
  if (previous.stopCheckCommand !== next.stopCheckCommand) patch.stopCheckCommand = next.stopCheckCommand;
  if (previous.tokenBudget !== next.tokenBudget) patch.tokenBudget = next.tokenBudget;
  if (previous.sandboxKeepWarmMinutes !== next.sandboxKeepWarmMinutes) patch.sandboxKeepWarmMinutes = next.sandboxKeepWarmMinutes;
  return Object.keys(patch).length > 0 ? patch : undefined;
}

function harnessParametersFromSettings(settings: HarnessSettings | null | undefined): TaskHarnessParameters {
  return {
    stopCheckCommand: settings?.stopCheck?.value.command ?? null,
    tokenBudget: settings?.tokenBudget?.value ?? null,
    sandboxKeepWarmMinutes: settings?.sandboxKeepWarmMinutes?.value ?? null
  };
}

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
    allowWaiting: true,
    harness: EMPTY_HARNESS_PARAMETERS
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
    harness?: unknown;
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
    allowWaiting: candidate.allowWaiting !== false,
    harness: normalizeHarnessParameters(candidate.harness)
  };
}

export function hasCustomTaskParameters(taskParameters: TaskParameters): boolean {
  return taskParameters.schedule.type !== "standard"
    || taskParameters.maxSteps !== null
    || taskParameters.timeLimitSeconds !== null
    || taskParameters.allowWaiting === false
    || hasHarnessParameters(taskParameters.harness);
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

const TIMED_RUN_EXTENSION_SECONDS = 60 * 60;

// The parameters that move a Timed task's deadline an hour later, or null when it has none.
export function extendTimedRun(taskParameters: TaskParameters, deadlineAt: string | null, now: number = Date.now()): TaskParameters | null {
  if (taskParameters.schedule.type !== "timed" || !deadlineAt) return null;
  const remainingSeconds = Math.max(0, Math.ceil((Date.parse(deadlineAt) - now) / 1000));
  return {
    ...taskParameters,
    schedule: { ...taskParameters.schedule, timeLimitSeconds: remainingSeconds + TIMED_RUN_EXTENSION_SECONDS }
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
  harness?: HarnessSettings | null;
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
    allowWaiting: input.allowWaiting,
    harness: harnessParametersFromSettings(input.harness)
  });
}

export function buildCreateTaskParametersPayload(taskParameters: TaskParameters): {
  maxSteps?: number;
  timeLimitSeconds?: number;
  allowWaiting?: boolean;
  harness?: HarnessUserPatch;
} | undefined {
  const payload: {
    maxSteps?: number;
    timeLimitSeconds?: number;
    allowWaiting?: boolean;
    harness?: HarnessUserPatch;
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

  const harness = buildHarnessPatch(EMPTY_HARNESS_PARAMETERS, taskParameters.harness);
  if (harness) {
    payload.harness = harness;
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}
