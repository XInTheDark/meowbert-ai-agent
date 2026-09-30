import { CronExpressionParser } from "cron-parser";

export interface TaskScheduleConfigInput {
  type: "standard" | "scheduled" | "infinite" | "timed";
  repeat?: string | null;
  timezone?: string | null;
  timeLimitSeconds?: number | null;
}

export interface ResolvedTaskScheduleConfig {
  mode: "scheduled" | "infinite";
  repeat: string | null;
  timezone: string;
  nextRunAt: string | null;
  runTimeoutSeconds: number | null;
  runDeadlineAt: string | null;
}

export function normalizeTimezoneOrThrow(rawTimezone?: string | null): string {
  const fallbackTimezone = "UTC";
  const value = rawTimezone?.trim();
  if (!value) {
    return fallbackTimezone;
  }

  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new Error("Invalid timezone");
  }
}

export function assertFiveFieldCron(repeat: string): string {
  const normalized = repeat.trim().replace(/\s+/g, " ");
  const parts = normalized.split(" ");
  if (parts.length !== 5) {
    throw new Error("repeat must be a 5-field cron expression (minute hour day-of-month month day-of-week)");
  }
  return normalized;
}

export function computeNextCronRunAt(repeat: string, timezone: string, fromDate: Date): Date {
  const iterator = CronExpressionParser.parse(repeat, {
    tz: timezone,
    currentDate: fromDate
  });
  return iterator.next().toDate();
}

export function validateCronCadence(repeat: string, timezone: string): void {
  const iterator = CronExpressionParser.parse(repeat, {
    tz: timezone,
    currentDate: new Date()
  });

  const first = iterator.next().toDate();
  const second = iterator.next().toDate();
  const deltaSeconds = Math.floor((second.getTime() - first.getTime()) / 1000);
  if (deltaSeconds < 60) {
    throw new Error("repeat cadence must be at least 1 minute");
  }
}

export function resolveTaskScheduleConfig(
  schedule: TaskScheduleConfigInput | null | undefined,
  options: {
    defaultTimezone?: string | null;
    now?: Date;
  } = {}
): ResolvedTaskScheduleConfig | null {
  if (!schedule || schedule.type === "standard") {
    return null;
  }

  const now = options.now ?? new Date();
  const defaultTimezone = normalizeTimezoneOrThrow(options.defaultTimezone);
  const scheduleTimezone = normalizeTimezoneOrThrow(schedule.timezone ?? defaultTimezone);

  if (schedule.type === "scheduled") {
    if (schedule.timeLimitSeconds) {
      throw new Error("timeLimitSeconds is not allowed for scheduled mode");
    }

    const repeat = assertFiveFieldCron(schedule.repeat ?? "");
    validateCronCadence(repeat, scheduleTimezone);
    return {
      mode: "scheduled",
      repeat,
      timezone: scheduleTimezone,
      nextRunAt: computeNextCronRunAt(repeat, scheduleTimezone, now).toISOString(),
      runTimeoutSeconds: null,
      runDeadlineAt: null
    };
  }

  if (schedule.type === "infinite") {
    if (schedule.repeat) {
      throw new Error("repeat is not allowed for infinite mode");
    }
    if (schedule.timeLimitSeconds) {
      throw new Error("timeLimitSeconds is not allowed for infinite mode");
    }

    return {
      mode: "infinite",
      repeat: null,
      timezone: scheduleTimezone,
      nextRunAt: null,
      runTimeoutSeconds: null,
      runDeadlineAt: null
    };
  }

  if (schedule.repeat) {
    throw new Error("repeat is not allowed for timed mode");
  }
  if (!schedule.timeLimitSeconds) {
    throw new Error("timeLimitSeconds is required for timed mode");
  }

  return {
    mode: "infinite",
    repeat: null,
    timezone: scheduleTimezone,
    nextRunAt: null,
    runTimeoutSeconds: schedule.timeLimitSeconds,
    runDeadlineAt: new Date(now.getTime() + schedule.timeLimitSeconds * 1000).toISOString()
  };
}
