import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { CronExpressionParser } from "cron-parser";
import {
  buildTaskRunQueueJobId,
  type TaskExecutionJob,
  type TaskRunDispatchCategory,
  type TaskRunToolOptions,
  type TaskSource
} from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { query, withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { insertTaskRunDispatchWithClient } from "../tasks/task-run-dispatch.js";

const DEFAULT_MAX_ACTIVE_RECURRING_TASKS_PER_ENV = 10;
const DEFAULT_MAX_ACTIVE_RECURRING_TASKS_PER_WORKSPACE = 50;
export const RECURRING_SCHEDULER_INTERVAL_MS = 5_000;
export const RECURRING_SCHEDULER_BATCH_SIZE = 80;

export const MIN_WAIT_SECONDS = 60;
export const MAX_WAIT_SECONDS = 7 * 24 * 60 * 60;

export interface RecurringScheduleRow {
  task_id: string;
  workspace_id: string;
  environment_id: string;
  source: string;
  mode: "scheduled" | "infinite";
  schedule_state: "active" | "paused" | "cancelled";
  repeat_cron: string | null;
  timezone: string;
  next_run_at: string | null;
  pending_run: boolean;
  enabled_tools_json: unknown;
  run_timeout_seconds: number | null;
  run_deadline_at: string | null;
}

export interface TaskScheduleInfo {
  mode: "scheduled" | "infinite";
  scheduleState: "active" | "paused" | "cancelled";
  repeat: string | null;
  timezone: string;
  nextRunAt: string | null;
  pendingRun: boolean;
  runTimeoutSeconds: number | null;
  runDeadlineAt: string | null;
}

export interface ScheduleTaskToolEnabledTools {
  web_search?: boolean | null;
  memory_search?: boolean | null;
  schedule_task?: boolean | null;
  subtasks?: boolean | null;
  computer_use?: boolean | null;
  enabled_skills?: string[] | null;
  enabled_sources?: string[] | null;
}

export interface CreateRecurringTaskInput {
  parentTaskId: string;
  // Stable id so a replayed tool call finds the task it already created.
  taskId?: string;
  title?: string | null;
  // The user accountable for the task; defaults to the parent task's initiator.
  initiatorUserId?: string | null;
  // A Master that hears about every run. Defaults to the Master already listening to the parent task.
  reportToMasterTaskId?: string | null;
  workspaceId: string;
  environmentId: string;
  source: TaskSource;
  connectorContextId: string | null;
  defaultTimezone: string;
  currentToolOptions: {
    webSearch: boolean;
    memorySearch: boolean;
    scheduleTask: boolean;
    subtasks: boolean;
    computerUse: boolean;
    enabledSkills: string[];
    enabledSources: string[];
  };
  message: string;
  mode: "scheduled" | "infinite";
  repeat: string | null;
  timezone: string | null;
  enabledTools: ScheduleTaskToolEnabledTools | null;
}

export interface EditCurrentTaskScheduleInput {
  taskId: string;
  repeat: string | null;
  timezone: string | null;
  enabledTools: ScheduleTaskToolEnabledTools | null;
}

export interface PauseRecurringScheduleResult {
  mode: "scheduled" | "infinite";
  state: "active" | "paused" | "cancelled";
  repeat: string | null;
  timezone: string;
  nextRunAt: string | null;
  runTimeoutSeconds: number | null;
  runDeadlineAt: string | null;
}

export interface PreparedRun {
  jobId: string;
  payload: TaskExecutionJob;
  schedulerManaged?: boolean;
}

export function normalizeTaskSource(rawSource: string): TaskSource {
  if (rawSource === "telegram" || rawSource === "discord" || rawSource === "github" || rawSource === "email") {
    return rawSource;
  }

  return "web";
}

export function validateIanaTimezone(rawTimezone?: string | null, fallback = "UTC"): string {
  const candidate = rawTimezone?.trim();
  if (!candidate) {
    return fallback;
  }

  try {
    Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    throw new Error(`Invalid timezone: ${candidate}`);
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

export function normalizeEnabledTools(
  rawValue: unknown,
  fallback?: TaskRunToolOptions | null
): TaskRunToolOptions | undefined {
  const fallbackSkills = Array.isArray(fallback?.enabledSkills)
    ? fallback.enabledSkills.filter((skill): skill is string => typeof skill === "string")
    : [];
  const fallbackSources = Array.isArray(fallback?.enabledSources)
    ? fallback.enabledSources.filter((source): source is string => typeof source === "string")
    : [];
  const base: TaskRunToolOptions = {
    webSearch: fallback?.webSearch === true,
    memorySearch: fallback?.memorySearch === true,
    scheduleTask: fallback?.scheduleTask === true,
    subtasks: fallback?.subtasks === true,
    computerUse: fallback?.computerUse === true,
    enabledSkills: fallbackSkills,
    enabledSources: fallbackSources
  };

  const baseHasEnabledValues =
    base.webSearch === true
    || base.memorySearch === true
    || base.scheduleTask === true
    || base.subtasks === true
    || base.computerUse === true
    || fallbackSkills.length > 0
    || fallbackSources.length > 0;
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return baseHasEnabledValues ? base : undefined;
  }

  const raw = rawValue as {
    webSearch?: unknown;
    web_search?: unknown;
    memorySearch?: unknown;
    memory_search?: unknown;
    scheduleTask?: unknown;
    schedule_task?: unknown;
    subtasks?: unknown;
    computerUse?: unknown;
    computer_use?: unknown;
    enabledSkills?: unknown;
    enabled_skills?: unknown;
    enabledSources?: unknown;
    enabled_sources?: unknown;
  };

  const normalizedSkills = Array.isArray(raw.enabledSkills)
    ? raw.enabledSkills
    : Array.isArray(raw.enabled_skills)
      ? raw.enabled_skills
      : base.enabledSkills;

  const enabledSkills = Array.isArray(normalizedSkills)
    ? Array.from(
        new Set(
          normalizedSkills
            .filter((skill): skill is string => typeof skill === "string")
            .map((skill) => skill.trim())
            .filter((skill) => skill.length > 0)
        )
      )
    : [];

  const normalizedSources = Array.isArray(raw.enabledSources)
    ? raw.enabledSources
    : Array.isArray(raw.enabled_sources)
      ? raw.enabled_sources
      : base.enabledSources;

  const enabledSources = Array.isArray(normalizedSources)
    ? Array.from(
        new Set(
          normalizedSources
            .filter((source): source is string => typeof source === "string")
            .map((source) => source.trim())
            .filter((source) => source.length > 0)
        )
      )
    : [];

  const result: TaskRunToolOptions = {
    webSearch:
      typeof raw.webSearch === "boolean"
        ? raw.webSearch
        : typeof raw.web_search === "boolean"
          ? raw.web_search
          : base.webSearch,
    memorySearch:
      typeof raw.memorySearch === "boolean"
        ? raw.memorySearch
        : typeof raw.memory_search === "boolean"
          ? raw.memory_search
          : base.memorySearch,
    scheduleTask:
      typeof raw.scheduleTask === "boolean"
        ? raw.scheduleTask
        : typeof raw.schedule_task === "boolean"
          ? raw.schedule_task
          : base.scheduleTask,
    subtasks: typeof raw.subtasks === "boolean" ? raw.subtasks : base.subtasks,
    computerUse:
      typeof raw.computerUse === "boolean"
        ? raw.computerUse
        : typeof raw.computer_use === "boolean"
          ? raw.computer_use
          : base.computerUse,
    enabledSkills,
    enabledSources
  };

  if (
    !result.webSearch
    && !result.memorySearch
    && !result.scheduleTask
    && !result.subtasks
    && !result.computerUse
    && enabledSkills.length === 0
    && enabledSources.length === 0
  ) {
    return undefined;
  }

  return result;
}

export function toMessageToolPayload(options: TaskRunToolOptions | undefined): Record<string, unknown> | undefined {
  if (!options) {
    return undefined;
  }

  const payload: Record<string, unknown> = {};
  if (options.webSearch === true) {
    payload.webSearch = true;
  }
  if (options.memorySearch === true) {
    payload.memorySearch = true;
  }
  if (options.scheduleTask === true) {
    payload.scheduleTask = true;
  }
  if (options.subtasks === true) {
    payload.subtasks = true;
  }
  if (options.computerUse === true) {
    payload.computerUse = true;
  }
  if (Array.isArray(options.enabledSkills) && options.enabledSkills.length > 0) {
    payload.enabledSkills = options.enabledSkills;
  }
  if (Array.isArray(options.enabledSources) && options.enabledSources.length > 0) {
    payload.enabledSources = options.enabledSources;
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

export function recurringRunMode(mode: "scheduled" | "infinite"): "scheduled_auto" | "infinite_auto" {
  return mode === "scheduled" ? "scheduled_auto" : "infinite_auto";
}

export function computeRunDeadlineAtIso(seconds: number, fromDate: Date = new Date()): string {
  return new Date(fromDate.getTime() + seconds * 1000).toISOString();
}

export async function queuePreparedRun(prepared: PreparedRun): Promise<void> {
  if (prepared.schedulerManaged) {
    return;
  }

  await taskQueue.add(prepared.jobId, prepared.payload, {
    jobId: prepared.jobId,
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 200
  });
}

export async function prepareRunWithClient(
  client: PoolClient,
  input: {
    taskId: string;
    workspaceId: string;
    environmentId: string;
    source: TaskSource;
    mode: "scheduled_auto" | "infinite_auto";
    toolOptionsOverride?: TaskRunToolOptions;
    priorityActorUserId?: string | null;
    dispatchCategory?: TaskRunDispatchCategory;
    eligibleAt?: string | Date | null;
  }
): Promise<PreparedRun> {
  const runId = randomUUID();
  const jobId = buildTaskRunQueueJobId(input.taskId, runId);

  const taskRes = await client.query<{ id: string; initiator_user_id: string | null }>(
    `SELECT id,
            initiator_user_id
       FROM tasks
      WHERE id = $1
      FOR UPDATE`,
    [input.taskId]
  );

  if ((taskRes.rowCount ?? 0) === 0) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  const attemptResult = await client.query<{ attempt_no: number }>(
    `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
       FROM task_runs
      WHERE task_id = $1`,
    [input.taskId]
  );

  const nextAttemptNo = attemptResult.rows[0].attempt_no;

  await client.query(
    `INSERT INTO task_runs (id, task_id, attempt_no, run_kind)
     VALUES ($1, $2, $3, $4)`,
    [runId, input.taskId, nextAttemptNo, input.mode]
  );

  await client.query(
    `UPDATE tasks
        SET status = 'queued',
            cancellation_requested = false,
            resume_after_interrupt = false,
            trashed_at = NULL,
            updated_at = now()
      WHERE id = $1`,
      [input.taskId]
  );

  const payload: TaskExecutionJob = {
    taskId: input.taskId,
    runId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    triggerSource: input.source,
    mode: input.mode,
    toolOptionsOverride: input.toolOptionsOverride
  };

  const schedulerManaged = input.dispatchCategory !== undefined;
  if (schedulerManaged) {
    await insertTaskRunDispatchWithClient(client, {
      runId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      payload,
      dispatchCategory: input.dispatchCategory,
      priorityActorUserId: input.priorityActorUserId ?? taskRes.rows[0]?.initiator_user_id ?? null,
      eligibleAt: input.eligibleAt
    });
  }

  return {
    jobId,
    payload,
    schedulerManaged
  };
}

export async function prepareRunInTransaction(input: {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  source: TaskSource;
  mode: "scheduled_auto" | "infinite_auto";
  toolOptionsOverride?: TaskRunToolOptions;
  priorityActorUserId?: string | null;
  dispatchCategory?: TaskRunDispatchCategory;
  eligibleAt?: string | Date | null;
}): Promise<PreparedRun> {
  return withTransaction((client) => prepareRunWithClient(client, input));
}

export function buildToolOptionsFromCurrent(input: CreateRecurringTaskInput): TaskRunToolOptions {
  const fallback: TaskRunToolOptions = {
    webSearch: input.currentToolOptions.webSearch,
    memorySearch: input.currentToolOptions.memorySearch,
    scheduleTask: input.currentToolOptions.scheduleTask,
    subtasks: input.currentToolOptions.subtasks,
    computerUse: input.currentToolOptions.computerUse,
    enabledSkills: [...input.currentToolOptions.enabledSkills],
    enabledSources: [...input.currentToolOptions.enabledSources]
  };

  return normalizeEnabledTools(input.enabledTools, fallback) ?? fallback;
}

export async function assertRecurringTaskLimits(workspaceId: string, environmentId: string): Promise<void> {
  const maxPerEnvironment = config.limits.maxActiveRecurringTasksPerEnv ?? DEFAULT_MAX_ACTIVE_RECURRING_TASKS_PER_ENV;
  const maxPerWorkspace =
    config.limits.maxActiveRecurringTasksWorkspace ?? DEFAULT_MAX_ACTIVE_RECURRING_TASKS_PER_WORKSPACE;

  const [envCountRes, wsCountRes] = await Promise.all([
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM task_schedules ts
         JOIN tasks t ON t.id = ts.task_id
        WHERE ts.schedule_state = 'active'
          AND t.environment_id = $1
          AND t.trashed_at IS NULL`,
      [environmentId]
    ),
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM task_schedules ts
         JOIN tasks t ON t.id = ts.task_id
        WHERE ts.schedule_state = 'active'
          AND t.workspace_id = $1
          AND t.trashed_at IS NULL`,
      [workspaceId]
    )
  ]);

  const activeInEnvironment = envCountRes.rows[0]?.count ?? 0;
  const activeInWorkspace = wsCountRes.rows[0]?.count ?? 0;

  if (activeInEnvironment >= maxPerEnvironment) {
    throw new Error(`Active recurring task limit reached for environment (${maxPerEnvironment})`);
  }

  if (activeInWorkspace >= maxPerWorkspace) {
    throw new Error(`Active recurring task limit reached for workspace (${maxPerWorkspace})`);
  }
}
