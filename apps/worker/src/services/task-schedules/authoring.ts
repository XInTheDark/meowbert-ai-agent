import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import fs from "node:fs";
import path from "node:path";
import { createTaskMessageMetadata } from "@meowbert/shared";
import type { TaskExecutionJob } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { insertTaskRunDispatchWithClient } from "../tasks/task-run-dispatch.js";
import {
  MAX_WAIT_SECONDS,
  MIN_WAIT_SECONDS,
  type CreateRecurringTaskInput,
  type EditCurrentTaskScheduleInput,
  type PauseRecurringScheduleResult,
  type TaskScheduleInfo,
  assertFiveFieldCron,
  assertRecurringTaskLimits,
  buildToolOptionsFromCurrent,
  computeNextCronRunAt,
  normalizeEnabledTools,
  recurringRunMode,
  toMessageToolPayload,
  validateCronCadence,
  validateIanaTimezone
} from "./shared.js";

// Runs of a recurring task keep reporting to the Master that was following the task it came from.
async function registerMasterListenerInTx(
  client: PoolClient,
  input: { taskId: string; parentTaskId: string; reportToMasterTaskId?: string | null }
): Promise<void> {
  const masterTaskId = input.reportToMasterTaskId
    ?? (await client.query<{ master_task_id: string }>(
      "SELECT master_task_id FROM project_master_listeners WHERE task_id = $1",
      [input.parentTaskId]
    )).rows[0]?.master_task_id;
  if (!masterTaskId) {
    return;
  }

  await client.query(
    `INSERT INTO project_master_listeners (task_id, master_task_id)
     VALUES ($1, $2)
     ON CONFLICT (task_id) DO NOTHING`,
    [input.taskId, masterTaskId]
  );
}

export async function createRecurringTaskFromTool(input: CreateRecurringTaskInput): Promise<{
  taskId: string;
  runId: string;
  mode: "scheduled" | "infinite";
  scheduleState: "active";
  repeat: string | null;
  timezone: string;
  nextRunAt: string | null;
}> {
  const mode = input.mode;
  const timezone = validateIanaTimezone(input.timezone, input.defaultTimezone || "UTC");
  const repeat = mode === "scheduled"
    ? assertFiveFieldCron(input.repeat ?? "")
    : null;

  if (mode === "scheduled" && repeat) {
    validateCronCadence(repeat, timezone);
  }

  if (mode === "infinite" && input.repeat) {
    throw new Error("repeat is not allowed for infinite mode");
  }

  await assertRecurringTaskLimits(input.workspaceId, input.environmentId);

  const taskId = input.taskId ?? randomUUID();
  const runId = randomUUID();
  const enabledTools = buildToolOptionsFromCurrent(input);
  const messageToolsPayload = toMessageToolPayload(enabledTools);

  const nextRunAt = mode === "scheduled" && repeat
    ? computeNextCronRunAt(repeat, timezone, new Date())
    : null;

  await withTransaction(async (client) => {
    const parentTaskRes = await client.query<{ initiator_user_id: string | null }>(
      `SELECT initiator_user_id
         FROM tasks
        WHERE id = $1`,
      [input.parentTaskId]
    );
    const initiatorUserId = input.initiatorUserId ?? parentTaskRes.rows[0]?.initiator_user_id ?? null;

    await client.query(
      `INSERT INTO tasks (
        id,
        workspace_id,
        environment_id,
        title,
        status,
        source,
        initiator_user_id,
        connector_context_id,
        default_timezone,
        task_root_path
      )
      VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9)`,
      [
        taskId,
        input.workspaceId,
        input.environmentId,
        input.title ?? (mode === "scheduled" ? "Scheduled Task" : "Infinite Task"),
        input.source,
        initiatorUserId,
        input.connectorContextId,
        timezone,
        `.meowbert/task-runs/${taskId}`
      ]
    );

    await registerMasterListenerInTx(client, {
      taskId,
      parentTaskId: input.parentTaskId,
      reportToMasterTaskId: input.reportToMasterTaskId
    });

    const messagePayload: Record<string, unknown> = {
      text: input.message
    };
    if (messageToolsPayload) {
      messagePayload.tools = messageToolsPayload;
    }
    const createdAt = new Date().toISOString();

    await client.query(
      `INSERT INTO task_messages (
        task_id,
        role,
        content_json,
        message_metadata_json,
        author_user_id,
        created_at
      )
      VALUES ($1, 'user', $2::jsonb, $3::jsonb, $4, $5)`,
      [
        taskId,
        JSON.stringify(messagePayload),
        JSON.stringify(createTaskMessageMetadata(createdAt)),
        initiatorUserId,
        createdAt
      ]
    );

    await client.query(
      `INSERT INTO task_schedules (
        task_id,
        mode,
        schedule_state,
        repeat_cron,
        timezone,
        next_run_at,
        pending_run,
        enabled_tools_json,
        created_from_task_id,
        run_timeout_seconds,
        run_deadline_at
      )
      VALUES ($1, $2, 'active', $3, $4, $5, false, $6::jsonb, $7, NULL, NULL)`,
      [
        taskId,
        mode,
        repeat,
        timezone,
        nextRunAt ? nextRunAt.toISOString() : null,
        JSON.stringify(enabledTools ?? {}),
        input.parentTaskId
      ]
    );

    await client.query(
      `INSERT INTO task_runs (id, task_id, attempt_no, run_kind)
       VALUES ($1, $2, 1, $3)`,
      [runId, taskId, recurringRunMode(mode)]
    );

    await insertTaskRunDispatchWithClient(client, {
      runId,
      taskId,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      payload: {
        taskId,
        runId,
        workspaceId: input.workspaceId,
        environmentId: input.environmentId,
        triggerSource: input.source,
        mode: recurringRunMode(mode),
        toolOptionsOverride: enabledTools
      },
      dispatchCategory: "background",
      priorityActorUserId: initiatorUserId
    });
  });

  return {
    taskId,
    runId,
    mode,
    scheduleState: "active",
    repeat,
    timezone,
    nextRunAt: nextRunAt ? nextRunAt.toISOString() : null
  };
}

export async function editCurrentTaskSchedule(input: EditCurrentTaskScheduleInput): Promise<{
  mode: "scheduled" | "infinite";
  state: "active" | "paused" | "cancelled";
  repeat: string | null;
  timezone: string;
  nextRunAt: string | null;
  runTimeoutSeconds: number | null;
  runDeadlineAt: string | null;
}> {
  return withTransaction(async (client) => {
    const scheduleRes = await client.query<{
      mode: "scheduled" | "infinite";
      schedule_state: "active" | "paused" | "cancelled";
      repeat_cron: string | null;
      timezone: string;
      enabled_tools_json: unknown;
      run_timeout_seconds: number | null;
      run_deadline_at: string | null;
    }>(
      `SELECT mode, schedule_state, repeat_cron, timezone, enabled_tools_json, run_timeout_seconds, run_deadline_at
         FROM task_schedules
        WHERE task_id = $1
        FOR UPDATE`,
      [input.taskId]
    );

    if ((scheduleRes.rowCount ?? 0) === 0) {
      throw new Error("Current task is not recurring");
    }

    const schedule = scheduleRes.rows[0];
    const mode = schedule.mode;

    if (mode === "infinite" && input.repeat) {
      throw new Error("repeat cannot be changed for infinite tasks");
    }

    const nextTimezone = input.timezone
      ? validateIanaTimezone(input.timezone, schedule.timezone)
      : schedule.timezone;

    const nextRepeat = mode === "scheduled"
      ? input.repeat
        ? assertFiveFieldCron(input.repeat)
        : schedule.repeat_cron
      : null;

    if (mode === "scheduled" && !nextRepeat) {
      throw new Error("scheduled tasks require repeat cron");
    }

    if (mode === "scheduled" && nextRepeat) {
      validateCronCadence(nextRepeat, nextTimezone);
    }

    const nextEnabledTools =
      input.enabledTools !== null
        ? normalizeEnabledTools(input.enabledTools, normalizeEnabledTools(schedule.enabled_tools_json))
        : normalizeEnabledTools(schedule.enabled_tools_json);

    const nextRunAt =
      mode === "scheduled" && schedule.schedule_state === "active" && nextRepeat
        ? computeNextCronRunAt(nextRepeat, nextTimezone, new Date())
        : null;

    await client.query(
      `UPDATE task_schedules
          SET repeat_cron = $2,
              timezone = $3,
              next_run_at = CASE
                WHEN mode = 'scheduled' AND schedule_state = 'active' THEN $4
                ELSE next_run_at
              END,
              enabled_tools_json = $5::jsonb,
              updated_at = now()
        WHERE task_id = $1`,
      [
        input.taskId,
        nextRepeat,
        nextTimezone,
        nextRunAt ? nextRunAt.toISOString() : null,
        JSON.stringify(nextEnabledTools ?? {})
      ]
    );

    return {
      mode,
      state: schedule.schedule_state,
      repeat: nextRepeat,
      timezone: nextTimezone,
      nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
      runTimeoutSeconds: schedule.run_timeout_seconds,
      runDeadlineAt: schedule.run_deadline_at
    };
  });
}

export async function pauseRecurringSchedule(taskId: string): Promise<PauseRecurringScheduleResult> {
  const updated = await query<{
    mode: "scheduled" | "infinite";
    schedule_state: "active" | "paused" | "cancelled";
    repeat_cron: string | null;
    timezone: string;
    next_run_at: string | null;
    run_timeout_seconds: number | null;
    run_deadline_at: string | null;
  }>(
    `UPDATE task_schedules
        SET schedule_state = 'paused',
            next_run_at = NULL,
            run_deadline_at = NULL,
            pending_run = false,
            updated_at = now()
      WHERE task_id = $1
        AND schedule_state != 'cancelled'
      RETURNING mode, schedule_state, repeat_cron, timezone, next_run_at, run_timeout_seconds, run_deadline_at`,
    [taskId]
  );

  if ((updated.rowCount ?? 0) === 0) {
    throw new Error("Current task is not an active recurring task");
  }

  const row = updated.rows[0];
  return {
    mode: row.mode,
    state: row.schedule_state,
    repeat: row.repeat_cron,
    timezone: row.timezone,
    nextRunAt: row.next_run_at,
    runTimeoutSeconds: row.run_timeout_seconds,
    runDeadlineAt: row.run_deadline_at
  };
}

export async function applyInfiniteWait(taskId: string, seconds: number): Promise<string> {
  if (!Number.isInteger(seconds) || seconds < MIN_WAIT_SECONDS || seconds > MAX_WAIT_SECONDS) {
    throw new Error(`wait.seconds must be between ${MIN_WAIT_SECONDS} and ${MAX_WAIT_SECONDS}`);
  }

  const nextRunAt = new Date(Date.now() + seconds * 1000);

  const updated = await query<{ next_run_at: string }>(
    `UPDATE task_schedules
        SET next_run_at = CASE
              WHEN run_deadline_at IS NOT NULL AND run_deadline_at < $2 THEN run_deadline_at
              ELSE $2
            END,
            pending_run = false,
            updated_at = now()
      WHERE task_id = $1
        AND mode = 'infinite'
        AND schedule_state = 'active'
        AND (run_deadline_at IS NULL OR run_deadline_at > now())
      RETURNING next_run_at`,
    [taskId, nextRunAt.toISOString()]
  );

  if ((updated.rowCount ?? 0) === 0) {
    throw new Error("Current task is not an active infinite recurring task, or its time limit already ended");
  }

  return updated.rows[0].next_run_at;
}

export async function pauseInfiniteScheduleAfterCheckin(taskId: string): Promise<void> {
  await query(
    `UPDATE task_schedules
        SET schedule_state = 'paused',
            next_run_at = NULL,
            run_deadline_at = NULL,
            pending_run = false,
            updated_at = now()
      WHERE task_id = $1
        AND mode = 'infinite'
        AND schedule_state = 'active'`,
      [taskId]
  );
}

export async function pauseTimedScheduleAfterCompletion(taskId: string): Promise<void> {
  await query(
    `UPDATE task_schedules
        SET schedule_state = 'paused',
            next_run_at = NULL,
            run_deadline_at = NULL,
            pending_run = false,
            updated_at = now()
      WHERE task_id = $1
        AND mode = 'infinite'
        AND run_timeout_seconds IS NOT NULL
        AND schedule_state = 'active'`,
    [taskId]
  );
}

export async function getTaskScheduleInfo(taskId: string): Promise<TaskScheduleInfo | null> {
  const result = await query<{
    mode: "scheduled" | "infinite";
    schedule_state: "active" | "paused" | "cancelled";
    repeat_cron: string | null;
    timezone: string;
    next_run_at: string | null;
    pending_run: boolean;
    run_timeout_seconds: number | null;
    run_deadline_at: string | null;
  }>(
    `SELECT mode, schedule_state, repeat_cron, timezone, next_run_at, pending_run, run_timeout_seconds, run_deadline_at
       FROM task_schedules
      WHERE task_id = $1`,
    [taskId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    mode: row.mode,
    scheduleState: row.schedule_state,
    repeat: row.repeat_cron,
    timezone: row.timezone,
    nextRunAt: row.next_run_at,
    pendingRun: row.pending_run,
    runTimeoutSeconds: row.run_timeout_seconds,
    runDeadlineAt: row.run_deadline_at
  };
}

export function ensureRecurringTaskStateFile(input: {
  taskRootPath: string;
  envRoot: string;
  schedule: TaskScheduleInfo;
  objective: string;
}): string {
  const stateDir = path.resolve(input.envRoot, input.taskRootPath, "state");
  const taskFilePath = path.resolve(stateDir, "TASK.md");
  fs.mkdirSync(stateDir, { recursive: true });

  if (!fs.existsSync(taskFilePath)) {
    const content = [
      `# Recurring Task State`,
      "",
      `- Root path: ${input.taskRootPath}`,
      `- Mode: ${input.schedule.mode}`,
      `- Timezone: ${input.schedule.timezone}`,
      input.schedule.mode === "scheduled" && input.schedule.repeat
        ? `- Repeat: ${input.schedule.repeat}`
        : "- Repeat: managed by wait tool",
      input.schedule.runTimeoutSeconds
        ? `- Run time limit: ${input.schedule.runTimeoutSeconds}s`
        : "- Run time limit: none",
      input.schedule.runDeadlineAt
        ? `- Current deadline: ${input.schedule.runDeadlineAt}`
        : "- Current deadline: none",
      "",
      "## Objective",
      input.objective.trim() || "No objective provided.",
      "",
      "## Operating Notes",
      "- Keep this file updated with durable context, assumptions, and next actions.",
      "- When context is compacted, rely on this file to preserve continuity.",
      "- Keep entries concise and practical."
    ].join("\n");

    fs.writeFileSync(taskFilePath, `${content}\n`, "utf-8");
  }

  return taskFilePath;
}

export async function resolveContinuationModeForInterruptedTask(
  taskId: string,
  currentMode?: TaskExecutionJob["mode"]
): Promise<TaskExecutionJob["mode"]> {
  const scheduleRes = await query<{ mode: "scheduled" | "infinite"; run_timeout_seconds: number | null }>(
    `SELECT mode, run_timeout_seconds
       FROM task_schedules
       WHERE task_id = $1`,
    [taskId]
  );

  if ((scheduleRes.rowCount ?? 0) === 0) {
    return currentMode ?? "default";
  }

  if (scheduleRes.rows[0].mode === "infinite") {
    return (scheduleRes.rows[0].run_timeout_seconds ?? 0) > 0 ? "infinite_auto" : "infinite_checkin";
  }

  return "default";
}
