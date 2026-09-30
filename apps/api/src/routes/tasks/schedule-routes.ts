import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import type { PlatformAgentPreset, TaskWorkflowType } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { resolveTaskScheduleConfig } from "../../services/tasks/task-schedule-config.js";
import {
  finalizeDeletedTasks,
  type TaskCleanupCandidateResult
} from "../../services/tasks/task-cleanup.js";
import {
  RecurringRunAccountabilityError,
  RecurringRunEntitlementError
} from "../../services/tasks/recurring-run-entitlement.js";
import { updateTaskTimeLimitConfigInTx } from "../../services/tasks/task-service/time-limit.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { getVisiblePlatformAgentsForUser } from "../../services/platform/platform-agents.js";
import {
  applyWorkflowTransitionInTx,
  assertTaskTypeTransitionIdleInTx,
  clearTaskWorkflowInTx
} from "../../services/tasks/task-workflow-transitions.js";
import { getTaskWorkflowOverview } from "../../services/tasks/task-workflows.js";
import { selectAgentSwarmNodeTypes } from "../../services/tasks/agent-swarm-node-types.js";
import {
  assertRecurringTaskLimits,
  buildEntitlementExceededPayload,
  buildTaskScheduleResponse,
  enqueueRecurringRunNow,
  normalizeRecurringToolOptions,
  taskParametersPatchBody,
  taskParams
} from "./shared.js";

type TaskParametersPatchInput = z.infer<typeof taskParametersPatchBody>;

interface LockedTaskRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  default_timezone: string;
  allow_waiting: boolean;
  workflow_type: TaskWorkflowType | null;
  title: string | null;
  root_path: string;
}

interface ExistingScheduleRow {
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

interface FinalTaskParametersRow {
  max_steps_override: number | null;
  time_limit_seconds: number | null;
  allow_waiting: boolean;
  default_timezone: string;
  workflow_type: TaskWorkflowType | null;
  schedule_mode: "scheduled" | "infinite" | null;
  task_type: "standard" | "scheduled" | "infinite" | "timed" | "long_horizon" | "agent_swarm";
  schedule_state: "active" | "paused" | "cancelled" | null;
  schedule_repeat_cron: string | null;
  schedule_timezone: string | null;
  schedule_next_run_at: string | null;
  schedule_pending_run: boolean | null;
  schedule_run_timeout_seconds: number | null;
  schedule_run_deadline_at: string | null;
}

async function loadLockedTask(client: PoolClient, taskId: string): Promise<LockedTaskRow | null> {
  const taskRes = await client.query<LockedTaskRow>(
    `SELECT t.id,
            t.workspace_id,
            t.environment_id,
            t.default_timezone,
            t.allow_waiting,
            t.workflow_type,
            t.title,
            e.root_path
       FROM tasks t
       JOIN environments e ON e.id = t.environment_id
      WHERE t.id = $1
      FOR UPDATE OF t`,
    [taskId]
  );
  return taskRes.rows[0] ?? null;
}

async function loadExistingSchedule(client: PoolClient, taskId: string): Promise<ExistingScheduleRow | null> {
  const scheduleRes = await client.query<ExistingScheduleRow>(
    `SELECT mode,
            schedule_state,
            repeat_cron,
            timezone,
            next_run_at,
            pending_run,
            enabled_tools_json,
            run_timeout_seconds,
            run_deadline_at
       FROM task_schedules
      WHERE task_id = $1
      FOR UPDATE`,
    [taskId]
  );

  return scheduleRes.rows[0] ?? null;
}

async function deleteTaskSchedule(client: PoolClient, taskId: string): Promise<void> {
  await client.query(`DELETE FROM task_schedules WHERE task_id = $1`, [taskId]);
}

function resolveExistingScheduleType(schedule: ExistingScheduleRow | null): "standard" | "scheduled" | "infinite" | "timed" {
  if (!schedule) return "standard";
  if (schedule.mode === "infinite" && schedule.run_timeout_seconds !== null) return "timed";
  return schedule.mode;
}

async function updateExistingSchedule(input: {
  body: TaskParametersPatchInput;
  client: PoolClient;
  existingSchedule: ExistingScheduleRow;
  nextSchedule: NonNullable<ReturnType<typeof resolveTaskScheduleConfig>>;
  taskId: string;
}): Promise<void> {
  const nextState = input.existingSchedule.schedule_state === "cancelled"
    ? "active"
    : input.existingSchedule.schedule_state;
  const nextEnabledTools = input.body.tools !== undefined
    ? normalizeRecurringToolOptions(input.body.tools)
    : normalizeRecurringToolOptions(input.existingSchedule.enabled_tools_json);
  const nextRunDeadlineAt = nextState === "active" && input.nextSchedule.runTimeoutSeconds !== null
    ? input.nextSchedule.runDeadlineAt
    : null;

  let nextRunAt: string | null = null;
  if (nextState === "active") {
    if (input.nextSchedule.mode === "scheduled") {
      nextRunAt = input.nextSchedule.nextRunAt;
    } else if (input.existingSchedule.mode === "infinite") {
      nextRunAt = input.existingSchedule.next_run_at;
      if (nextRunAt && nextRunDeadlineAt && nextRunAt > nextRunDeadlineAt) {
        nextRunAt = nextRunDeadlineAt;
      }
    }
  }

  await input.client.query(
    `UPDATE task_schedules
        SET mode = $2,
            schedule_state = $3,
            repeat_cron = $4,
            timezone = $5,
            next_run_at = $6,
            enabled_tools_json = $7::jsonb,
            run_timeout_seconds = $8,
            run_deadline_at = $9,
            updated_at = now()
      WHERE task_id = $1`,
    [
      input.taskId,
      input.nextSchedule.mode,
      nextState,
      input.nextSchedule.repeat,
      input.nextSchedule.timezone,
      nextRunAt,
      JSON.stringify(nextEnabledTools ?? {}),
      input.nextSchedule.runTimeoutSeconds,
      nextRunDeadlineAt
    ]
  );
}

async function insertSchedule(input: {
  body: TaskParametersPatchInput;
  client: PoolClient;
  nextSchedule: NonNullable<ReturnType<typeof resolveTaskScheduleConfig>>;
  taskId: string;
  userId: string;
}): Promise<void> {
  await input.client.query(
    `INSERT INTO task_schedules (
      task_id,
      mode,
      schedule_state,
      repeat_cron,
      timezone,
      next_run_at,
      pending_run,
      enabled_tools_json,
      created_by_user_id,
      created_from_task_id,
      run_timeout_seconds,
      run_deadline_at
    )
    VALUES ($1, $2, 'active', $3, $4, $5, false, $6::jsonb, $7, NULL, $8, $9)`,
    [
      input.taskId,
      input.nextSchedule.mode,
      input.nextSchedule.repeat,
      input.nextSchedule.timezone,
      input.nextSchedule.nextRunAt,
      JSON.stringify(normalizeRecurringToolOptions(input.body.tools) ?? {}),
      input.userId,
      input.nextSchedule.runTimeoutSeconds,
      input.nextSchedule.runDeadlineAt
    ]
  );
}

async function applySchedulePatch(input: {
  body: TaskParametersPatchInput;
  client: PoolClient;
  existingSchedule: ExistingScheduleRow | null;
  task: LockedTaskRow;
  taskId: string;
  userId: string;
}): Promise<void> {
  if (!input.body.schedule) {
    return;
  }

  const nextSchedule = resolveTaskScheduleConfig(input.body.schedule, {
    defaultTimezone: input.task.default_timezone,
    now: new Date()
  });

  if (!input.existingSchedule && nextSchedule) {
    await assertRecurringTaskLimits(input.task.workspace_id, input.task.environment_id);
  }
  if (!nextSchedule) {
    await deleteTaskSchedule(input.client, input.taskId);
    return;
  }
  if (input.existingSchedule) {
    await updateExistingSchedule({
      body: input.body,
      client: input.client,
      existingSchedule: input.existingSchedule,
      nextSchedule,
      taskId: input.taskId
    });
    return;
  }

  await insertSchedule({
    body: input.body,
    client: input.client,
    nextSchedule,
    taskId: input.taskId,
    userId: input.userId
  });
}

async function updateTaskCoreParameters(input: {
  body: TaskParametersPatchInput;
  client: PoolClient;
  taskId: string;
}): Promise<void> {
  await input.client.query(
    `UPDATE tasks
        SET max_steps_override = CASE WHEN $2 THEN $3 ELSE max_steps_override END,
            allow_waiting = CASE WHEN $4 THEN $5 ELSE allow_waiting END,
            updated_at = now()
      WHERE id = $1`,
    [
      input.taskId,
      Object.prototype.hasOwnProperty.call(input.body, "maxSteps"),
      input.body.maxSteps ?? null,
      Object.prototype.hasOwnProperty.call(input.body, "allowWaiting"),
      input.body.allowWaiting ?? true
    ]
  );

  if (Object.prototype.hasOwnProperty.call(input.body, "timeLimitSeconds")) {
    await updateTaskTimeLimitConfigInTx(
      input.client,
      input.taskId,
      input.body.timeLimitSeconds ?? null
    );
  }
}

async function loadFinalParameters(client: PoolClient, taskId: string): Promise<FinalTaskParametersRow | null> {
  const finalTaskRes = await client.query<FinalTaskParametersRow>(
    `SELECT t.max_steps_override,
            t.time_limit_seconds,
            t.allow_waiting,
            t.default_timezone,
            t.workflow_type,
            ts.mode AS schedule_mode,
            CASE
              WHEN t.workflow_type IS NOT NULL THEN t.workflow_type
              WHEN ts.task_id IS NULL THEN 'standard'
              WHEN ts.mode = 'infinite' AND ts.run_timeout_seconds IS NOT NULL THEN 'timed'
              ELSE ts.mode
            END AS task_type,
            ts.schedule_state,
            ts.repeat_cron AS schedule_repeat_cron,
            ts.timezone AS schedule_timezone,
            ts.next_run_at AS schedule_next_run_at,
            ts.pending_run AS schedule_pending_run,
            ts.run_timeout_seconds AS schedule_run_timeout_seconds,
            ts.run_deadline_at AS schedule_run_deadline_at
       FROM tasks t
       LEFT JOIN task_schedules ts ON ts.task_id = t.id
      WHERE t.id = $1`,
    [taskId]
  );

  return finalTaskRes.rows[0] ?? null;
}

function emptyTaskCleanupCandidates(): TaskCleanupCandidateResult {
  return { taskIds: [], taskRootPaths: [], workspacePaths: [], archiveKeys: [] };
}

function mergeTaskCleanupCandidates(
  first: TaskCleanupCandidateResult,
  second: TaskCleanupCandidateResult
): TaskCleanupCandidateResult {
  return {
    taskIds: Array.from(new Set([...first.taskIds, ...second.taskIds])),
    taskRootPaths: Array.from(new Set([...first.taskRootPaths, ...second.taskRootPaths])),
    workspacePaths: Array.from(new Set([...first.workspacePaths, ...second.workspacePaths])),
    archiveKeys: Array.from(new Set([...first.archiveKeys, ...second.archiveKeys]))
  };
}

async function patchTaskParameters(taskId: string, userId: string, body: TaskParametersPatchInput) {
  const dynamicNodeTypes: PlatformAgentPreset[] | undefined = body.workflow?.type === "agent_swarm"
    ? selectAgentSwarmNodeTypes((await getVisiblePlatformAgentsForUser(userId)).presets)
    : undefined;
  const result = await withTransaction(async (client) => {
    const task = await loadLockedTask(client, taskId);
    if (!task) {
      return null;
    }

    let cleanup = emptyTaskCleanupCandidates();

    const existingSchedule = body.schedule ? await loadExistingSchedule(client, taskId) : null;
    const scheduleTypeChanged = body.schedule !== undefined && (
      task.workflow_type !== null
      || body.schedule.type !== resolveExistingScheduleType(existingSchedule)
    );
    if (body.workflow || scheduleTypeChanged) {
      await assertTaskTypeTransitionIdleInTx(client, taskId);
    }

    if (body.workflow) {
      cleanup = mergeTaskCleanupCandidates(cleanup, await applyWorkflowTransitionInTx(client, {
        taskId,
        userId,
        task,
        workflow: body.workflow,
        dynamicNodeTypes
      }));
      if (body.workflow.type !== "standard") {
        await deleteTaskSchedule(client, taskId);
      }
    }

    if (body.schedule) {
      if (body.schedule.type !== "standard" && !body.workflow) {
        cleanup = mergeTaskCleanupCandidates(cleanup, await clearTaskWorkflowInTx(client, taskId));
      }
      await applySchedulePatch({
        body,
        client,
        existingSchedule,
        task,
        taskId,
        userId
      });
    }

    await updateTaskCoreParameters({ body, client, taskId });
    return {
      parameters: await loadFinalParameters(client, taskId),
      cleanup,
      environmentId: task.environment_id,
      workspaceId: task.workspace_id,
      rootPath: task.root_path
    };
  });

  if (!result || !result.parameters) {
    return result?.parameters ?? null;
  }

  if (result.cleanup.taskIds.length > 0) {
    await finalizeDeletedTasks({
      environmentId: result.environmentId,
      workspaceId: result.workspaceId,
      rootPath: result.rootPath,
      deleted: result.cleanup
    });
  }

  return result.parameters;
}

async function handlePatchTaskParameters(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const body = taskParametersPatchBody.parse(request.body ?? {});
  await assertTaskMember(params.taskId, request.user.id);

  const updated = await patchTaskParameters(params.taskId, request.user.id, body);
  if (!updated) {
    return reply.status(404).send({ error: "Task not found" });
  }

  return {
    taskId: params.taskId,
    max_steps_override: updated.max_steps_override,
    time_limit_seconds: updated.time_limit_seconds,
    allow_waiting: updated.allow_waiting,
    default_timezone: updated.default_timezone,
    task_type: updated.task_type,
    schedule: buildTaskScheduleResponse(updated),
    workflow: await getTaskWorkflowOverview(params.taskId)
  };
}

async function handlePauseTaskSchedule(request: FastifyRequest) {
  const params = taskParams.parse(request.params);
  await assertTaskMember(params.taskId, request.user.id);

  const updated = await query<{ task_id: string }>(
    `UPDATE task_schedules
        SET schedule_state = 'paused',
            next_run_at = NULL,
            run_deadline_at = NULL,
            pending_run = false,
            updated_at = now()
      WHERE task_id = $1
        AND schedule_state != 'cancelled'
    RETURNING task_id`,
    [params.taskId]
  );
  if ((updated.rowCount ?? 0) === 0) {
    throw new Error("Task is not an active recurring task");
  }

  return { ok: true, taskId: params.taskId, scheduleState: "paused" };
}

async function handleResumeTaskSchedule(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const access = await assertTaskMember(params.taskId, request.user.id);
  let run: Awaited<ReturnType<typeof enqueueRecurringRunNow>>;
  try {
    run = await enqueueRecurringRunNow({
      taskId: params.taskId,
      workspaceId: access.workspaceId,
      environmentId: access.environmentId,
      selectionUserId: request.user.id,
      forceActivate: true
    });
  } catch (error) {
    if (error instanceof RecurringRunEntitlementError) {
      return reply.status(429).send(buildEntitlementExceededPayload(error.entitlement));
    }
    if (error instanceof RecurringRunAccountabilityError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    throw error;
  }

  return { ok: true, taskId: params.taskId, scheduleState: "active", ...run };
}

async function handleRunTaskScheduleNow(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const access = await assertTaskMember(params.taskId, request.user.id);

  const scheduleStateRes = await query<{ schedule_state: "active" | "paused" | "cancelled" }>(
    `SELECT schedule_state
       FROM task_schedules
      WHERE task_id = $1`,
    [params.taskId]
  );
  if ((scheduleStateRes.rowCount ?? 0) === 0) {
    throw new Error("Task is not recurring");
  }
  if (scheduleStateRes.rows[0].schedule_state !== "active") {
    throw new Error("Task schedule is paused");
  }

  let run: Awaited<ReturnType<typeof enqueueRecurringRunNow>>;
  try {
    run = await enqueueRecurringRunNow({
      taskId: params.taskId,
      workspaceId: access.workspaceId,
      environmentId: access.environmentId,
      selectionUserId: request.user.id
    });
  } catch (error) {
    if (error instanceof RecurringRunEntitlementError) {
      return reply.status(429).send(buildEntitlementExceededPayload(error.entitlement));
    }
    if (error instanceof RecurringRunAccountabilityError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    throw error;
  }

  return { ok: true, taskId: params.taskId, ...run };
}

export async function registerTaskScheduleRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.patch("/api/tasks/:taskId/parameters", { preHandler: fastify.authenticate }, handlePatchTaskParameters);
  fastify.post("/api/tasks/:taskId/schedule/pause", { preHandler: fastify.authenticate }, handlePauseTaskSchedule);
  fastify.post("/api/tasks/:taskId/schedule/resume", { preHandler: fastify.authenticate }, handleResumeTaskSchedule);
  fastify.post("/api/tasks/:taskId/schedule/run-now", { preHandler: fastify.authenticate }, handleRunTaskScheduleNow);
}
