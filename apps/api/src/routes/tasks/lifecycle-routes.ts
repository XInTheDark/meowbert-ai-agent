import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TaskExecutionTarget, TaskStatus } from "@meowbert/shared";
import { z } from "zod";
import { query, withTransaction } from "../../lib/db.js";
import { validateProjectExecutionTarget } from "../../services/devices/execution-targets.js";
import {
  permanentlyDeleteTasks,
  TaskDeletionConflictError
} from "../../services/tasks/task-cleanup.js";
import { enqueueTaskFromBranch, enqueueRun, resolveActiveLeafMessageId } from "../../services/tasks/task-service/index.js";
import { cancelTaskAndSchedules } from "../../services/tasks/task-cancellation.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { patchTaskBody, taskCommandInterruptBody, taskParams, taskTrashBody } from "./shared.js";

const contextActionBody = z.object({
  contextAction: z.enum(["compact", "clear"]).default("compact")
});

async function validateTaskExecutionTargetPatch(input: {
  taskId: string;
  userId: string;
  workspaceId: string;
  environmentId: string;
  executionTarget: TaskExecutionTarget;
}): Promise<{ status: number; error: string } | null> {
  const taskRes = await query<{
    status: TaskStatus;
    workflow_type: string | null;
    workflow_internal_role: string | null;
    read_only: boolean;
    network_disabled: boolean;
    is_project_master: boolean;
    has_schedule: boolean;
  }>(
    `SELECT t.status,
            t.workflow_type,
            t.workflow_internal_role,
            t.read_only,
            t.network_disabled,
            EXISTS (SELECT 1 FROM project_masters pm WHERE pm.task_id = t.id) AS is_project_master,
            EXISTS (SELECT 1 FROM task_schedules ts WHERE ts.task_id = t.id AND ts.schedule_state <> 'cancelled') AS has_schedule
       FROM tasks t
      WHERE t.id = $1`,
    [input.taskId]
  );
  const task = taskRes.rows[0];
  if (!task) return { status: 404, error: "Task not found" };
  if (task.status === "queued" || task.status === "starting" || task.status === "running") {
    return { status: 409, error: "Stop or wait for the active run before changing execution mode." };
  }
  if (task.workflow_internal_role || task.is_project_master) {
    return { status: 400, error: "Execution mode cannot be changed for this task." };
  }
  const targetError = await validateProjectExecutionTarget({
    userId: input.userId,
    workspaceId: input.workspaceId,
    projectId: input.environmentId,
    executionTarget: input.executionTarget,
    workflow: task.workflow_type ? { type: task.workflow_type } : undefined,
    schedule: task.has_schedule ? { type: "scheduled" } : undefined,
    restricted: task.read_only === true || task.network_disabled === true
  });
  return targetError ? { status: 400, error: targetError } : null;
}

async function handlePatchTask(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const body = patchTaskBody.parse(request.body);
  const access = await assertTaskMember(params.taskId, request.user.id);

  if (body.folderId) {
    const folderRes = await query<{ id: string }>(
      `SELECT id
         FROM task_folders
        WHERE id = $1
          AND environment_id = $2`,
      [body.folderId, access.environmentId]
    );

    if ((folderRes.rowCount ?? 0) === 0) {
      throw new Error("Folder not found");
    }
  }

  if (body.executionTarget) {
    const targetError = await validateTaskExecutionTargetPatch({
      taskId: params.taskId,
      userId: request.user.id,
      workspaceId: access.workspaceId,
      environmentId: access.environmentId,
      executionTarget: body.executionTarget
    });
    if (targetError) return reply.status(targetError.status).send({ error: targetError.error });
  }

  await query(
    `UPDATE tasks
        SET title = CASE WHEN $2 THEN $3 ELSE title END,
            folder_id = CASE WHEN $4 THEN $5::uuid ELSE folder_id END,
            folder_sort_order = COALESCE($6, folder_sort_order),
            execution_target = CASE WHEN $7 THEN $8::jsonb ELSE execution_target END,
            updated_at = now()
      WHERE id = $1`,
    [
      params.taskId,
      Object.hasOwn(body, "title"),
      body.title ?? null,
      Object.hasOwn(body, "folderId"),
      body.folderId ?? null,
      body.folderSortOrder ?? null,
      Object.hasOwn(body, "executionTarget"),
      body.executionTarget ? JSON.stringify(body.executionTarget) : null
    ]
  );

  return {
    ok: true,
    ...(body.executionTarget ? { execution_target: body.executionTarget } : {})
  };
}

async function handleTrashTask(request: FastifyRequest) {
  const params = taskParams.parse(request.params);
  const body = taskTrashBody.parse(request.body ?? {});
  await assertTaskMember(params.taskId, request.user.id);

  await query(
    `UPDATE tasks
        SET trashed_at = CASE WHEN $2 THEN now() ELSE NULL END,
            updated_at = now()
      WHERE id = $1`,
    [params.taskId, body.trashed]
  );

  return { ok: true, trashed: body.trashed };
}

async function handleDeleteTask(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const taskRes = await query<{
    workspace_id: string;
    environment_id: string;
    status: TaskStatus;
    trashed_at: string | null;
    is_incognito: boolean;
    root_path: string;
  }>(
    `SELECT t.workspace_id,
            t.environment_id,
            t.status,
            t.trashed_at,
            t.is_incognito,
            e.root_path
       FROM tasks t
       JOIN environments e ON e.id = t.environment_id
       JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
      WHERE t.id = $1
        AND wm.user_id = $2`,
    [params.taskId, request.user.id]
  );

  if ((taskRes.rowCount ?? 0) === 0) {
    return reply.status(404).send({ error: "Task not found" });
  }
  if (!taskRes.rows[0].trashed_at && !taskRes.rows[0].is_incognito) {
    return reply.status(409).send({ error: "Move task to trash before deleting permanently." });
  }
  if (
    taskRes.rows[0].status === "queued"
    || taskRes.rows[0].status === "starting"
    || taskRes.rows[0].status === "running"
  ) {
    return reply.status(409).send({ error: "Task is still active. Cancel it before deleting permanently." });
  }

  let result: Awaited<ReturnType<typeof permanentlyDeleteTasks>>;
  try {
    result = await permanentlyDeleteTasks({
      environmentId: taskRes.rows[0].environment_id,
      workspaceId: taskRes.rows[0].workspace_id,
      rootPath: taskRes.rows[0].root_path,
      taskIds: [params.taskId]
    });
  } catch (error) {
    if (error instanceof TaskDeletionConflictError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    throw error;
  }

  return { ok: true, ...result };
}

async function handleRetryTask(request: FastifyRequest) {
  const params = taskParams.parse(request.params);
  const access = await assertTaskMember(params.taskId, request.user.id);
  const activeLeafMessageId = await resolveActiveLeafMessageId({ taskId: params.taskId, userId: request.user.id });

  if (!activeLeafMessageId) {
    throw new Error("No messages available to retry from");
  }

  const run = await enqueueTaskFromBranch({
    taskId: params.taskId,
    workspaceId: access.workspaceId,
    environmentId: access.environmentId,
    triggerSource: "web",
    branchMessageId: activeLeafMessageId,
    selectionUserId: request.user.id,
    interruptQueued: true
  });

  return {
    taskId: params.taskId,
    mode: run.mode,
    activeLeafMessageId: run.activeLeafMessageId,
    ...(run.mode === "enqueued" ? { runId: run.runId, attemptNo: run.attemptNo } : {})
  };
}

async function handleCancelTask(request: FastifyRequest) {
  const params = taskParams.parse(request.params);
  await assertTaskMember(params.taskId, request.user.id);
  await cancelTaskAndSchedules(params.taskId);
  return { ok: true };
}

async function handleInterruptCommand(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const body = taskCommandInterruptBody.parse(request.body ?? {});
  await assertTaskMember(params.taskId, request.user.id);

  const decision = await withTransaction(async (client) => {
    const taskRes = await client.query<{ status: TaskStatus }>(
      `SELECT status
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [params.taskId]
    );
    if ((taskRes.rowCount ?? 0) === 0) {
      return { kind: "missing_task" as const };
    }
    if (taskRes.rows[0].status !== "running") {
      return { kind: "not_running" as const };
    }

    const runRes = await client.query<{ id: string }>(
      `WITH active_run AS (
         SELECT id
           FROM task_runs
          WHERE task_id = $1
            AND ended_at IS NULL
          ORDER BY started_at DESC
          LIMIT 1
       )
       UPDATE task_runs
          SET interrupt_command_step = $2
         FROM active_run
        WHERE task_runs.id = active_run.id
       RETURNING task_runs.id`,
      [params.taskId, body.step]
    );
    if ((runRes.rowCount ?? 0) === 0) {
      return { kind: "missing_run" as const };
    }

    return { kind: "ok" as const, runId: runRes.rows[0].id };
  });

  if (decision.kind === "missing_task") {
    return reply.status(404).send({ error: "Task not found" });
  }
  if (decision.kind === "not_running" || decision.kind === "missing_run") {
    return reply.status(409).send({ error: "Task is not running a command right now." });
  }

  return { ok: true, taskId: params.taskId, runId: decision.runId, step: body.step };
}

async function handleCompactTask(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const body = contextActionBody.parse(request.body ?? {});
  const access = await assertTaskMember(params.taskId, request.user.id);

  const taskRes = await query<{ status: TaskStatus }>(
    `SELECT status
       FROM tasks
      WHERE id = $1`,
    [params.taskId]
  );
  if ((taskRes.rowCount ?? 0) === 0) {
    return reply.status(404).send({ error: "Task not found" });
  }

  const currentStatus = taskRes.rows[0].status;
  if (currentStatus === "running" || currentStatus === "starting" || currentStatus === "queued") {
    return reply.status(409).send({ error: "Task is running. Wait for it to finish before compaction." });
  }

  const activeLeafMessageId = await resolveActiveLeafMessageId({
    taskId: params.taskId,
    userId: request.user.id
  });
  const run = await enqueueRun({
    taskId: params.taskId,
    workspaceId: access.workspaceId,
    environmentId: access.environmentId,
    triggerSource: "web",
    mode: "compact_only",
    restoreStatus: currentStatus,
    branchMessageId: activeLeafMessageId ?? undefined,
    selectionUserId: request.user.id,
    priorityActorUserId: request.user.id,
    dispatchCategory: "followup",
    contextAction: body.contextAction
  });

  return {
    taskId: params.taskId,
    mode: "compact_only",
    contextAction: body.contextAction,
    runId: run.runId,
    attemptNo: run.attemptNo
  };
}

export async function registerTaskLifecycleRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.patch("/api/tasks/:taskId", { preHandler: fastify.authenticate }, handlePatchTask);
  fastify.post("/api/tasks/:taskId/trash", { preHandler: fastify.authenticate }, handleTrashTask);
  fastify.delete("/api/tasks/:taskId", { preHandler: fastify.authenticate }, handleDeleteTask);
  fastify.post("/api/tasks/:taskId/retry", { preHandler: fastify.authenticate }, handleRetryTask);
  fastify.post("/api/tasks/:taskId/cancel", { preHandler: fastify.authenticate }, handleCancelTask);
  fastify.post("/api/tasks/:taskId/commands/interrupt", { preHandler: fastify.authenticate }, handleInterruptCommand);
  fastify.post("/api/tasks/:taskId/compact", { preHandler: fastify.authenticate }, handleCompactTask);
}
