import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { isProjectMasterTask } from "../../services/project-master/master-task.js";
import { ensureTaskHistoryWarm } from "../../services/tasks/task-history.js";
import { appendTaskUserMessageAndEnqueue, takeTaskQueuedMessage } from "../../services/tasks/task-service/index.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { taskAgentSelectionSchema, taskAttachmentsSchema, taskToolOptionsSchema } from "./shared.js";

const queuedMessageParams = z.object({ taskId: z.string().uuid(), queuedMessageId: z.string().uuid() });

function parseOrUndefined<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// Sends a queued message straight away, interrupting the run the way follow-ups used to.
// Its prompt usage was recorded when it was queued.
async function handleSendQueuedMessageNow(request: FastifyRequest, reply: FastifyReply) {
  const params = queuedMessageParams.parse(request.params);
  const access = await assertTaskMember(params.taskId, request.user.id);
  await ensureTaskHistoryWarm(params.taskId);
  const content = await takeTaskQueuedMessage(params.taskId, params.queuedMessageId);
  if (!content) {
    return reply.status(404).send({ error: "This message was already delivered." });
  }

  const isMaster = await isProjectMasterTask(params.taskId);
  const taskAgent = content.taskAgent as { id: string | null } | undefined;
  const run = await appendTaskUserMessageAndEnqueue({
    taskId: params.taskId,
    workspaceId: access.workspaceId,
    environmentId: access.environmentId,
    triggerSource: "web",
    message: typeof content.text === "string" ? content.text : "",
    attachments: parseOrUndefined(taskAttachmentsSchema, content.attachments),
    tools: parseOrUndefined(taskToolOptionsSchema, content.tools),
    agent: parseOrUndefined(taskAgentSelectionSchema, content.agent),
    taskAgent: isMaster ? taskAgent : undefined,
    userId: request.user.id,
    interruptQueued: true,
    connectorContextId: isMaster ? null : undefined
  });
  return { taskId: run.taskId, mode: run.mode, messageId: run.messageId, activeLeafMessageId: run.activeLeafMessageId };
}

async function handleDeleteQueuedMessage(request: FastifyRequest) {
  const params = queuedMessageParams.parse(request.params);
  await assertTaskMember(params.taskId, request.user.id);
  const content = await takeTaskQueuedMessage(params.taskId, params.queuedMessageId);
  return { removed: content !== null };
}

export async function registerTaskQueuedMessageRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/api/tasks/:taskId/queued-messages/:queuedMessageId/send-now",
    { preHandler: fastify.authenticate },
    handleSendQueuedMessageNow
  );
  fastify.delete(
    "/api/tasks/:taskId/queued-messages/:queuedMessageId",
    { preHandler: fastify.authenticate },
    handleDeleteQueuedMessage
  );
}
