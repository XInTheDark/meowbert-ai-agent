import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../../lib/db.js";
import { cloneTaskIntoFork } from "../../services/tasks/task-forks.js";
import { ensureTaskHistoryWarm } from "../../services/tasks/task-history.js";
import { listTaskMessageLineageIds } from "../../services/tasks/task-message-lineage.js";
import { assertEnvironmentMember, assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { publicTaskForkBody, publicTaskShareParams, taskForkBody, taskParams } from "./shared.js";

const TASK_FORK_COPY_TIMEOUT_MS = 30 * 60 * 1000;

function extendForkCopySocketTimeout(request: FastifyRequest, reply: FastifyReply): void {
  request.raw.setTimeout(TASK_FORK_COPY_TIMEOUT_MS);
  reply.raw.setTimeout(TASK_FORK_COPY_TIMEOUT_MS);
}

async function loadForkLineageMessageIds(taskId: string, messageId: string | undefined): Promise<string[] | null> {
  if (!messageId) {
    return null;
  }

  const lineageMessageIds = await listTaskMessageLineageIds(taskId, messageId);
  if (!lineageMessageIds || lineageMessageIds.length === 0) {
    return null;
  }

  return lineageMessageIds;
}

async function handleShareTask(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  await assertTaskMember(params.taskId, request.user.id);

  const shareResult = await withTransaction(async (client) => {
    const taskRes = await client.query<{ public_share_id: string | null; is_incognito: boolean }>(
      `SELECT public_share_id, is_incognito
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [params.taskId]
    );
    if ((taskRes.rowCount ?? 0) === 0) {
      return null;
    }
    if (taskRes.rows[0].is_incognito) {
      return { publicShareId: null, isNew: false, blocked: true };
    }

    const existingShareId = taskRes.rows[0].public_share_id;
    if (existingShareId) {
      return { publicShareId: existingShareId, isNew: false };
    }

    const publicShareId = randomUUID();
    await client.query(
      `UPDATE tasks
          SET public_share_id = $2,
              public_shared_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [params.taskId, publicShareId]
    );
    return { publicShareId, isNew: true };
  });

  if (!shareResult) {
    return reply.status(404).send({ error: "Task not found" });
  }
  if ("blocked" in shareResult) {
    return reply.status(409).send({ error: "Incognito tasks cannot be shared." });
  }

  return {
    taskId: params.taskId,
    public_share_id: shareResult.publicShareId,
    public_path: `/share/tasks/${shareResult.publicShareId}`,
    is_new: shareResult.isNew
  };
}

async function handleUnshareTask(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  await assertTaskMember(params.taskId, request.user.id);

  const updateRes = await query<{ id: string }>(
    `UPDATE tasks
        SET public_share_id = NULL,
            public_shared_at = NULL,
            updated_at = now()
      WHERE id = $1
    RETURNING id`,
    [params.taskId]
  );

  if ((updateRes.rowCount ?? 0) === 0) {
    return reply.status(404).send({ error: "Task not found" });
  }

  return { ok: true, taskId: params.taskId };
}

async function handleForkTask(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const body = taskForkBody.parse(request.body ?? {});
  if (body.copyTaskFiles !== false) {
    extendForkCopySocketTimeout(request, reply);
  }
  const access = await assertTaskMember(params.taskId, request.user.id);
  await ensureTaskHistoryWarm(params.taskId);
  const lineageMessageIds = await loadForkLineageMessageIds(params.taskId, body.messageId);
  if (body.messageId && !lineageMessageIds) {
    return reply.status(404).send({ error: "Message not found" });
  }

  const forkRes = await cloneTaskIntoFork({
    sourceTaskId: params.taskId,
    destinationWorkspaceId: access.workspaceId,
    destinationEnvironmentId: access.environmentId,
    userId: request.user.id,
    lineageMessageIds,
    title: body.title,
    copyTaskFiles: body.copyTaskFiles !== false
  });

  return reply.status(201).send(forkRes);
}

async function handleForkPublicTask(request: FastifyRequest, reply: FastifyReply) {
  const params = publicTaskShareParams.parse(request.params);
  const body = publicTaskForkBody.parse(request.body ?? {});
  const destinationAccess = await assertEnvironmentMember(body.environmentId, request.user.id);

  const sourceTaskRes = await query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE public_share_id = $1`,
    [params.shareId]
  );
  if ((sourceTaskRes.rowCount ?? 0) === 0) {
    return reply.status(404).send({ error: "Shared task not found" });
  }

  const sourceTaskId = sourceTaskRes.rows[0].id;
  await ensureTaskHistoryWarm(sourceTaskId);
  const lineageMessageIds = await loadForkLineageMessageIds(sourceTaskId, body.messageId);
  if (body.messageId && !lineageMessageIds) {
    return reply.status(404).send({ error: "Message not found" });
  }
  const forkRes = await cloneTaskIntoFork({
    sourceTaskId,
    destinationWorkspaceId: destinationAccess.workspaceId,
    destinationEnvironmentId: body.environmentId,
    userId: request.user.id,
    lineageMessageIds,
    title: body.title,
    copyTaskFiles: false
  });

  return reply.status(201).send(forkRes);
}

export async function registerTaskSharingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/tasks/:taskId/share", { preHandler: fastify.authenticate }, handleShareTask);
  fastify.post("/api/tasks/:taskId/unshare", { preHandler: fastify.authenticate }, handleUnshareTask);
  fastify.post("/api/tasks/:taskId/fork", { preHandler: fastify.authenticate }, handleForkTask);
  fastify.post("/api/public/tasks/:shareId/fork", { preHandler: fastify.authenticate }, handleForkPublicTask);
}
