import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getPromptEntitlementStatus, recordPromptUsageIfRequired } from "../../services/billing/entitlements.js";
import { requireVisiblePlatformAgentSelectionForUser } from "../../services/platform/platform-agents.js";
import { assertCanvasBelongsToProject, touchProjectCanvasTask } from "../../services/canvases/project-canvases.js";
import { ensureTaskHistoryWarm } from "../../services/tasks/task-history.js";
import { createThreadTask, listTaskThreads } from "../../services/tasks/task-threads.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import {
  buildEntitlementExceededPayload,
  createTaskThreadBody,
  taskParams,
  taskThreadsQuery
} from "./shared.js";

async function handleListTaskThreads(request: FastifyRequest) {
  const params = taskParams.parse(request.params);
  const query = taskThreadsQuery.parse(request.query ?? {});
  await assertTaskMember(params.taskId, request.user.id);

  return {
    items: await listTaskThreads({
      parentTaskId: params.taskId,
      parentMessageId: query.parentMessageId
    })
  };
}

async function handleCreateTaskThread(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const body = createTaskThreadBody.parse(request.body ?? {});
  const access = await assertTaskMember(params.taskId, request.user.id);
  await ensureTaskHistoryWarm(params.taskId);
  const entitlement = await getPromptEntitlementStatus(request.user.id);

  if (!entitlement.allowed) {
    return reply.status(429).send(buildEntitlementExceededPayload(entitlement));
  }

  const selectedAgent = await requireVisiblePlatformAgentSelectionForUser(request.user.id, body.agent);
  if (body.interactiveCanvasId) {
    await assertCanvasBelongsToProject({
      canvasId: body.interactiveCanvasId,
      workspaceId: access.workspaceId,
      environmentId: access.environmentId
    });
  }
  const created = await createThreadTask({
    taskId: body.taskId,
    parentTaskId: params.taskId,
    parentMessageId: body.messageId,
    userId: request.user.id,
    message: body.message,
    attachments: body.attachments,
    selectedText: body.selectedText,
    selectedTextLocation: body.selectedTextLocation,
    tools: body.tools,
    agent: selectedAgent,
    interactiveCanvasId: body.interactiveCanvasId ?? undefined,
    interactiveCanvasIntent: body.interactiveCanvasIntent ?? (body.interactiveCanvasId ? "update" : undefined)
  });
  if (body.interactiveCanvasId) {
    await touchProjectCanvasTask({
      canvasId: body.interactiveCanvasId,
      taskId: created.taskId
    });
  }

  await recordPromptUsageIfRequired({
    userId: request.user.id,
    mode: entitlement.mode,
    taskId: created.taskId,
    taskMessageId: created.messageId
  });

  return reply.status(201).send({
    taskId: created.taskId,
    messageId: created.messageId,
    activeLeafMessageId: created.activeLeafMessageId,
    runId: created.runId,
    attemptNo: created.attemptNo
  });
}

export async function registerTaskThreadRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/tasks/:taskId/threads", { preHandler: fastify.authenticate }, handleListTaskThreads);
  fastify.post("/api/tasks/:taskId/threads", { preHandler: fastify.authenticate }, handleCreateTaskThread);
}
