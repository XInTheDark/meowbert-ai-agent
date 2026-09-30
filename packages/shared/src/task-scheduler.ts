import { z } from "zod";

export const TASK_RUN_DISPATCH_CATEGORY_VALUES = ["new", "followup", "background"] as const;
export type TaskRunDispatchCategory = (typeof TASK_RUN_DISPATCH_CATEGORY_VALUES)[number];

export const TASK_RUN_DISPATCH_CLASS_VALUES = [
  "admin_interactive",
  "interactive_followup",
  "interactive_new",
  "background"
] as const;
export type TaskRunDispatchClass = (typeof TASK_RUN_DISPATCH_CLASS_VALUES)[number];

export const TASK_RUN_DISPATCH_QUEUE_STATE_VALUES = [
  "pending",
  "admitted",
  "running",
  "finished",
  "cancelled"
] as const;
export type TaskRunDispatchQueueState = (typeof TASK_RUN_DISPATCH_QUEUE_STATE_VALUES)[number];

export const DEFAULT_MAX_QUEUED_AHEAD_PER_WORKSPACE = 1;
export const DEFAULT_BACKGROUND_AGING_MINUTES = 15;

export interface TaskSchedulerSettings {
  defaultEnvironmentConcurrency: number;
  maxWorkspaceConcurrency: number;
  maxQueuedAheadPerWorkspace: number;
  backgroundAgingMinutes: number;
}

const taskSchedulerSettingsShape = {
  defaultEnvironmentConcurrency: z.number().int().positive(),
  maxWorkspaceConcurrency: z.number().int().positive(),
  maxQueuedAheadPerWorkspace: z.number().int().min(0),
  backgroundAgingMinutes: z.number().int().min(0)
};

export const taskSchedulerSettingsSchema = z.object(taskSchedulerSettingsShape);
const partialTaskSchedulerSettingsSchema = taskSchedulerSettingsSchema.partial();

export function buildDefaultTaskSchedulerSettings(input: {
  defaultEnvironmentConcurrency: number;
  maxWorkspaceConcurrency: number;
  maxQueuedAheadPerWorkspace?: number;
  backgroundAgingMinutes?: number;
}): TaskSchedulerSettings {
  return {
    defaultEnvironmentConcurrency: Math.max(1, Math.floor(input.defaultEnvironmentConcurrency)),
    maxWorkspaceConcurrency: Math.max(1, Math.floor(input.maxWorkspaceConcurrency)),
    maxQueuedAheadPerWorkspace: Math.max(
      0,
      Math.floor(input.maxQueuedAheadPerWorkspace ?? DEFAULT_MAX_QUEUED_AHEAD_PER_WORKSPACE)
    ),
    backgroundAgingMinutes: Math.max(0, Math.floor(input.backgroundAgingMinutes ?? DEFAULT_BACKGROUND_AGING_MINUTES))
  };
}

export function normalizeTaskSchedulerSettings(
  rawValue: unknown,
  defaults: TaskSchedulerSettings
): TaskSchedulerSettings {
  const parsed = partialTaskSchedulerSettingsSchema.safeParse(rawValue);
  if (!parsed.success) {
    return defaults;
  }

  return {
    defaultEnvironmentConcurrency:
      parsed.data.defaultEnvironmentConcurrency ?? defaults.defaultEnvironmentConcurrency,
    maxWorkspaceConcurrency: parsed.data.maxWorkspaceConcurrency ?? defaults.maxWorkspaceConcurrency,
    maxQueuedAheadPerWorkspace:
      parsed.data.maxQueuedAheadPerWorkspace ?? defaults.maxQueuedAheadPerWorkspace,
    backgroundAgingMinutes: parsed.data.backgroundAgingMinutes ?? defaults.backgroundAgingMinutes
  };
}

export function resolveTaskRunDispatchClass(input: {
  category: TaskRunDispatchCategory;
  priorityActorIsSuperAdmin: boolean;
}): TaskRunDispatchClass {
  if (input.category === "background") {
    return "background";
  }

  if (input.priorityActorIsSuperAdmin) {
    return "admin_interactive";
  }

  return input.category === "followup" ? "interactive_followup" : "interactive_new";
}

export function resolveEffectiveTaskRunDispatchClass(input: {
  dispatchClass: TaskRunDispatchClass;
  queuedAt: string | Date;
  backgroundAgingMinutes: number;
  now?: Date;
}): TaskRunDispatchClass {
  if (input.dispatchClass !== "background" || input.backgroundAgingMinutes <= 0) {
    return input.dispatchClass;
  }

  const queuedAtMs = input.queuedAt instanceof Date ? input.queuedAt.getTime() : new Date(input.queuedAt).getTime();
  if (!Number.isFinite(queuedAtMs)) {
    return input.dispatchClass;
  }

  const nowMs = input.now?.getTime() ?? Date.now();
  const thresholdMs = input.backgroundAgingMinutes * 60_000;
  if (nowMs - queuedAtMs >= thresholdMs) {
    return "interactive_new";
  }

  return input.dispatchClass;
}

export function resolveDispatchClassRank(dispatchClass: TaskRunDispatchClass): number {
  switch (dispatchClass) {
    case "admin_interactive":
      return 1;
    case "interactive_followup":
      return 2;
    case "interactive_new":
      return 3;
    case "background":
    default:
      return 4;
  }
}

export function compareTaskRunDispatchClasses(a: TaskRunDispatchClass, b: TaskRunDispatchClass): number {
  return resolveDispatchClassRank(a) - resolveDispatchClassRank(b);
}

export function resolveBullMqPriorityForDispatchClass(dispatchClass: TaskRunDispatchClass): number {
  return resolveDispatchClassRank(dispatchClass);
}
