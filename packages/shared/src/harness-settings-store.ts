import {
  applyHarnessSettingsChange,
  type HarnessActor,
  type HarnessLimits,
  type HarnessNotify,
  type HarnessSettings,
  type HarnessSettingsChange
} from "./harness-settings.js";

// Reads and writes a task's harness settings. Keep-alive and the wake interval live on the task's
// Timed schedule; the rest live in task_harness_settings. A pg Pool or PoolClient satisfies the
// database surface, so the API (user changes) and the worker (agent changes) share one store.

// A change the task can't take, such as a stop check on a read-only task. The message is safe to show.
export class HarnessSettingsError extends Error {
  readonly exposeMessage = true;

  constructor(message: string, readonly statusCode: 400 | 404 = 400) {
    super(message);
    this.name = "HarnessSettingsError";
  }
}

export interface HarnessSettingsDb {
  query<T extends object>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

interface HarnessRow {
  workspace_id: string;
  environment_id: string;
  default_timezone: string | null;
  time_limit_deadline_at: string | Date | null;
  read_only: boolean | null;
  parent_task_id: string | null;
  workflow_parent_task_id: string | null;
  workflow_type: string | null;
  spent_tokens: string | number | null;
  schedule_mode: "scheduled" | "infinite" | null;
  schedule_state: "active" | "paused" | "cancelled" | null;
  run_timeout_seconds: number | null;
  run_deadline_at: string | Date | null;
  keep_alive_set_by: HarnessActor | null;
  wake_interval_seconds: number | null;
  wake_interval_set_by: HarnessActor | null;
  stop_check_command: string | null;
  stop_check_timeout_seconds: number | null;
  stop_check_set_by: HarnessActor | null;
  token_budget: string | number | null;
  token_budget_set_by: HarnessActor | null;
  notify: HarnessNotify | null;
  notify_set_by: HarnessActor | null;
  sandbox_keep_warm_minutes: number | null;
  sandbox_keep_warm_set_by: HarnessActor | null;
}

export interface LoadedHarnessTask {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  defaultTimezone: string;
  taskTimeLimitDeadlineAt: string | null;
  readOnly: boolean;
  isRootTask: boolean;
  workflowType: string | null;
  spentTokens: number;
  // The task's schedule when it is not a Timed one, so keep-alive can refuse it.
  otherSchedule: { mode: "scheduled" | "infinite" } | null;
  hasTimedSchedule: boolean;
  settings: HarnessSettings;
}

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function setting<T>(value: T | null, setBy: HarnessActor | null): { value: T; setBy: HarnessActor } | null {
  return value === null ? null : { value, setBy: setBy ?? "user" };
}

function isTimedSchedule(row: HarnessRow): boolean {
  return row.schedule_mode === "infinite" && row.run_timeout_seconds !== null;
}

function mapSettings(row: HarnessRow): HarnessSettings {
  const timedActive = isTimedSchedule(row) && row.schedule_state === "active" && row.run_deadline_at !== null;
  return {
    // A composer Timed task predates set_by tracking; it is the user's.
    keepAliveUntil: timedActive ? setting(toIso(row.run_deadline_at), row.keep_alive_set_by) : null,
    // The interval only means something during keep-alive; a paused schedule keeps it for next time.
    wakeIntervalSeconds: timedActive ? setting(row.wake_interval_seconds, row.wake_interval_set_by) : null,
    stopCheck: row.stop_check_command
      ? setting({ command: row.stop_check_command, timeoutSeconds: row.stop_check_timeout_seconds ?? 600 }, row.stop_check_set_by)
      : null,
    tokenBudget: setting(row.token_budget === null ? null : Number(row.token_budget), row.token_budget_set_by),
    notify: setting(row.notify, row.notify_set_by),
    sandboxKeepWarmMinutes: setting(row.sandbox_keep_warm_minutes, row.sandbox_keep_warm_set_by)
  };
}

const LOAD_SQL = `
  SELECT t.workspace_id, t.environment_id, t.default_timezone, t.time_limit_deadline_at, t.read_only,
         t.parent_task_id, t.workflow_parent_task_id, t.workflow_type, t.spent_tokens,
         s.mode AS schedule_mode, s.schedule_state, s.run_timeout_seconds, s.run_deadline_at,
         s.keep_alive_set_by, s.wake_interval_seconds, s.wake_interval_set_by,
         h.stop_check_command, h.stop_check_timeout_seconds, h.stop_check_set_by,
         h.token_budget, h.token_budget_set_by,
         h.notify, h.notify_set_by, h.sandbox_keep_warm_minutes, h.sandbox_keep_warm_set_by
    FROM tasks t
    LEFT JOIN task_schedules s ON s.task_id = t.id
    LEFT JOIN task_harness_settings h ON h.task_id = t.id
   WHERE t.id = $1`;

function mapLoadedTask(taskId: string, row: HarnessRow): LoadedHarnessTask {
  return {
    taskId,
    workspaceId: row.workspace_id,
    environmentId: row.environment_id,
    defaultTimezone: row.default_timezone || "UTC",
    taskTimeLimitDeadlineAt: toIso(row.time_limit_deadline_at),
    readOnly: row.read_only === true,
    isRootTask: row.parent_task_id === null && row.workflow_parent_task_id === null,
    workflowType: row.workflow_type,
    spentTokens: Number(row.spent_tokens ?? 0),
    otherSchedule: row.schedule_mode && !isTimedSchedule(row) ? { mode: row.schedule_mode } : null,
    hasTimedSchedule: isTimedSchedule(row),
    settings: mapSettings(row)
  };
}

export async function loadHarnessTaskForUpdate(client: HarnessSettingsDb, taskId: string): Promise<LoadedHarnessTask | null> {
  const result = await client.query<HarnessRow>(`${LOAD_SQL} FOR UPDATE OF t`, [taskId]);
  const row = result.rows[0];
  return row ? mapLoadedTask(taskId, row) : null;
}

export async function loadHarnessTask(client: HarnessSettingsDb, taskId: string): Promise<LoadedHarnessTask | null> {
  const result = await client.query<HarnessRow>(LOAD_SQL, [taskId]);
  const row = result.rows[0];
  return row ? mapLoadedTask(taskId, row) : null;
}

async function endKeepAlive(client: HarnessSettingsDb, taskId: string): Promise<void> {
  await client.query(
    `UPDATE task_schedules
        SET schedule_state = 'paused',
            next_run_at = NULL,
            run_deadline_at = NULL,
            pending_run = false,
            idle_cycle_count = 0,
            failed_cycle_count = 0,
            updated_at = now()
      WHERE task_id = $1
        AND mode = 'infinite'
        AND run_timeout_seconds IS NOT NULL`,
    [taskId]
  );
}

async function startOrMoveKeepAlive(
  client: HarnessSettingsDb,
  task: LoadedHarnessTask,
  keepAlive: NonNullable<HarnessSettings["keepAliveUntil"]>,
  input: { actorUserId: string | null; now: Date }
): Promise<void> {
  const runTimeoutSeconds = Math.max(1, Math.ceil((new Date(keepAlive.value).getTime() - input.now.getTime()) / 1000));
  if (task.hasTimedSchedule) {
    await client.query(
      `UPDATE task_schedules
          SET schedule_state = 'active',
              run_timeout_seconds = $2,
              run_deadline_at = $3,
              keep_alive_set_by = $4,
              failed_cycle_count = CASE WHEN schedule_state = 'active' THEN failed_cycle_count ELSE 0 END,
              idle_cycle_count = CASE WHEN schedule_state = 'active' THEN idle_cycle_count ELSE 0 END,
              updated_at = now()
        WHERE task_id = $1`,
      [task.taskId, runTimeoutSeconds, keepAlive.value, keepAlive.setBy]
    );
    return;
  }
  await client.query(
    `INSERT INTO task_schedules (
       task_id, mode, schedule_state, repeat_cron, timezone, next_run_at, pending_run, enabled_tools_json,
       created_by_user_id, created_from_task_id, run_timeout_seconds, run_deadline_at, keep_alive_set_by
     )
     VALUES ($1, 'infinite', 'active', NULL, $2, NULL, false, '{}'::jsonb, $3, NULL, $4, $5, $6)`,
    [task.taskId, task.defaultTimezone, input.actorUserId, runTimeoutSeconds, keepAlive.value, keepAlive.setBy]
  );
}

async function saveKeepAlive(client: HarnessSettingsDb, task: LoadedHarnessTask, next: HarnessSettings, input: { actorUserId: string | null; now: Date }): Promise<void> {
  if (next.keepAliveUntil === null) {
    if (task.settings.keepAliveUntil !== null) await endKeepAlive(client, task.taskId);
  } else if (JSON.stringify(next.keepAliveUntil) !== JSON.stringify(task.settings.keepAliveUntil)) {
    await startOrMoveKeepAlive(client, task, next.keepAliveUntil, input);
  }
  // Only an explicit change writes the interval. Ending or restarting keep-alive leaves the stored
  // one alone, so it applies again when keep-alive comes back.
  if (next.keepAliveUntil === null) return;
  if (JSON.stringify(next.wakeIntervalSeconds) === JSON.stringify(task.settings.wakeIntervalSeconds)) return;
  await client.query(
    `UPDATE task_schedules
        SET wake_interval_seconds = $2, wake_interval_set_by = $3, updated_at = now()
      WHERE task_id = $1 AND mode = 'infinite' AND run_timeout_seconds IS NOT NULL`,
    [task.taskId, next.wakeIntervalSeconds?.value ?? null, next.wakeIntervalSeconds?.setBy ?? null]
  );
}

async function saveOtherSettings(client: HarnessSettingsDb, taskId: string, next: HarnessSettings): Promise<void> {
  await client.query(
    `INSERT INTO task_harness_settings (
       task_id, stop_check_command, stop_check_timeout_seconds, stop_check_set_by,
       token_budget, token_budget_set_by, notify, notify_set_by,
       sandbox_keep_warm_minutes, sandbox_keep_warm_set_by, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (task_id) DO UPDATE SET
       stop_check_command = EXCLUDED.stop_check_command,
       stop_check_timeout_seconds = EXCLUDED.stop_check_timeout_seconds,
       stop_check_set_by = EXCLUDED.stop_check_set_by,
       token_budget = EXCLUDED.token_budget,
       token_budget_set_by = EXCLUDED.token_budget_set_by,
       notify = EXCLUDED.notify,
       notify_set_by = EXCLUDED.notify_set_by,
       sandbox_keep_warm_minutes = EXCLUDED.sandbox_keep_warm_minutes,
       sandbox_keep_warm_set_by = EXCLUDED.sandbox_keep_warm_set_by,
       updated_at = now()`,
    [
      taskId,
      next.stopCheck?.value.command ?? null,
      next.stopCheck?.value.timeoutSeconds ?? null,
      next.stopCheck?.setBy ?? null,
      next.tokenBudget?.value ?? null,
      next.tokenBudget?.setBy ?? null,
      next.notify?.value ?? null,
      next.notify?.setBy ?? null,
      next.sandboxKeepWarmMinutes?.value ?? null,
      next.sandboxKeepWarmMinutes?.setBy ?? null
    ]
  );
}

export async function saveHarnessSettings(
  client: HarnessSettingsDb,
  task: LoadedHarnessTask,
  next: HarnessSettings,
  input: { actorUserId: string | null; now: Date }
): Promise<void> {
  await saveKeepAlive(client, task, next, input);
  await saveOtherSettings(client, task.taskId, next);
}

function assertTaskAllowsChange(task: LoadedHarnessTask, change: HarnessSettingsChange, next: HarnessSettings): void {
  if (!task.isRootTask) throw new HarnessSettingsError("Harness settings are only available on root tasks.");
  if (task.readOnly && (change.stopCheckCommand || change.keepAliveMinutes)) {
    throw new HarnessSettingsError("Read-only tasks can't keep alive or run a stop check.");
  }
  if (change.keepAliveMinutes && task.otherSchedule) {
    throw new HarnessSettingsError(`This task already recurs (${task.otherSchedule.mode === "scheduled" ? "cron schedule" : "infinite loop"}); keep-alive is for one-off tasks.`);
  }
  if (change.keepAliveMinutes && task.workflowType === "long_horizon") {
    throw new HarnessSettingsError("Long Horizon tasks can't use keep-alive.");
  }
  if (change.wakeIntervalSeconds && !next.keepAliveUntil) {
    throw new HarnessSettingsError("A wake interval only applies during keep-alive (a Timed task); turn keep-alive on first.");
  }
}

// Applies a change for the user or the agent. Call it inside a transaction: it locks the task row.
export async function updateHarnessSettingsInTx(client: HarnessSettingsDb, input: {
  taskId: string;
  actor: HarnessActor;
  actorUserId: string | null;
  change: HarnessSettingsChange;
  limits: HarnessLimits;
  now: Date;
}): Promise<{ task: LoadedHarnessTask; settings: HarnessSettings }> {
  const task = await loadHarnessTaskForUpdate(client, input.taskId);
  if (!task) throw new HarnessSettingsError("Task not found.", 404);
  const result = applyHarnessSettingsChange(task.settings, input.change, {
    actor: input.actor,
    now: input.now,
    limits: input.limits,
    taskTimeLimitDeadlineAt: task.taskTimeLimitDeadlineAt
  });
  if (!result.ok) throw new HarnessSettingsError(result.error);
  assertTaskAllowsChange(task, input.change, result.next);
  if (result.changed.length > 0) {
    await saveHarnessSettings(client, task, result.next, { actorUserId: input.actorUserId, now: input.now });
  }
  return { task, settings: result.next };
}
