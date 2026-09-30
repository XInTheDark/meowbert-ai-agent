import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { query, withTransaction } from "../../lib/db.js";
import { getPromptEntitlementStatus, recordPromptUsageIfRequired } from "../../services/billing/entitlements.js";
import {
  filterVisiblePlatformAgentSelectionForUser,
  requireVisiblePlatformAgentSelectionForUser
} from "../../services/platform/platform-agents.js";
import { assertCanvasBelongsToProject, touchProjectCanvasTask } from "../../services/canvases/project-canvases.js";
import { findNearestUserAncestorMessage } from "../../services/tasks/task-message-lineage.js";
import {
  appendTaskUserMessageAndEnqueue,
  buildUserMessageContent,
  replaceTaskMessageAndEnqueue,
  setTaskBranchSelection
} from "../../services/tasks/task-service/index.js";
import { isProjectMasterTask } from "../../services/project-master/master-task.js";
import { ensureTaskHistoryWarm } from "../../services/tasks/task-history.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import {
  buildEntitlementExceededPayload,
  CONTINUE_TASK_PROMPT,
  editTaskMessageBody,
  postTaskMessageBody,
  taskAgentSelectionSchema,
  taskBranchSelectionBody,
  taskMessageParams,
  taskParams,
  taskToolOptionsSchema
} from "./shared.js";

function buildAppendMessageResponse(run: Awaited<ReturnType<typeof appendTaskUserMessageAndEnqueue>>) {
  if (run.mode === "enqueued") {
    return {
      taskId: run.taskId,
      mode: run.mode,
      runId: run.runId,
      attemptNo: run.attemptNo,
      messageId: run.messageId,
      activeLeafMessageId: run.activeLeafMessageId
    };
  }

  return {
    taskId: run.taskId,
    mode: run.mode,
    messageId: run.messageId,
    activeLeafMessageId: run.activeLeafMessageId
  };
}

async function loadVisibleAgentSelection(userId: string, rawAgent: unknown) {
  const parsedAgent = taskAgentSelectionSchema.safeParse(rawAgent);
  if (!parsedAgent.success) {
    return undefined;
  }

  return filterVisiblePlatformAgentSelectionForUser(userId, parsedAgent.data);
}

function loadMessageTools(rawTools: unknown) {
  if (!rawTools || typeof rawTools !== "object" || Array.isArray(rawTools)) {
    return undefined;
  }

  return taskToolOptionsSchema.parse(rawTools);
}

async function handlePostTaskMessage(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const body = postTaskMessageBody.parse(request.body);
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
  const run = await appendTaskUserMessageAndEnqueue({
    taskId: params.taskId,
    workspaceId: access.workspaceId,
    environmentId: access.environmentId,
    triggerSource: "web",
    message: body.message,
    attachments: body.attachments,
    tools: body.tools,
    agent: selectedAgent,
    userId: request.user.id,
    interactiveCanvasId: body.interactiveCanvasId ?? undefined,
    interactiveCanvasIntent: body.interactiveCanvasIntent ?? (body.interactiveCanvasId ? "update" : undefined),
    interruptQueued: true,
    // Talking to the Master on the web moves its replies (and proactive updates) back to the web.
    connectorContextId: (await isProjectMasterTask(params.taskId)) ? null : undefined
  });
  if (body.interactiveCanvasId) {
    await touchProjectCanvasTask({
      canvasId: body.interactiveCanvasId,
      taskId: params.taskId
    });
  }

  await recordPromptUsageIfRequired({
    userId: request.user.id,
    mode: entitlement.mode,
    taskId: params.taskId,
    taskMessageId: run.messageId
  });

  return buildAppendMessageResponse(run);
}

async function handleBranchSelection(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const body = taskBranchSelectionBody.parse(request.body ?? {});
  await assertTaskMember(params.taskId, request.user.id);
  await ensureTaskHistoryWarm(params.taskId);

  const messageRes = await query<{ id: string }>(
    `SELECT id
       FROM task_messages
      WHERE task_id = $1
        AND id = $2`,
    [params.taskId, body.activeLeafMessageId]
  );
  if ((messageRes.rowCount ?? 0) === 0) {
    return reply.status(404).send({ error: "Message not found" });
  }

  await setTaskBranchSelection({
    taskId: params.taskId,
    userId: request.user.id,
    activeLeafMessageId: body.activeLeafMessageId
  });

  return { taskId: params.taskId, activeLeafMessageId: body.activeLeafMessageId };
}

async function handleRetryTaskMessage(request: FastifyRequest, reply: FastifyReply) {
  const params = taskMessageParams.parse(request.params);
  const access = await assertTaskMember(params.taskId, request.user.id);
  await ensureTaskHistoryWarm(params.taskId);
  const entitlement = await getPromptEntitlementStatus(request.user.id);

  if (!entitlement.allowed) {
    return reply.status(429).send(buildEntitlementExceededPayload(entitlement));
  }

  const targetMessageRes = await query<{ id: string }>(
    `SELECT id
       FROM task_messages
      WHERE task_id = $1
        AND id = $2`,
    [params.taskId, params.messageId]
  );
  if ((targetMessageRes.rowCount ?? 0) === 0) {
    throw new Error("Message not found");
  }

  const pivotMessage = await findNearestUserAncestorMessage(params.taskId, params.messageId);
  const pivotMessageText = typeof pivotMessage?.content_json.text === "string" ? pivotMessage.content_json.text.trim() : "";
  if (!pivotMessage || pivotMessageText.length === 0) {
    throw new Error("No user message found to retry from");
  }

  const run = await replaceTaskMessageAndEnqueue({
    taskId: params.taskId,
    workspaceId: access.workspaceId,
    environmentId: access.environmentId,
    triggerSource: "web",
    userId: request.user.id,
    sourceMessageId: pivotMessage.id,
    parentMessageId: pivotMessage.parent_message_id,
    oldContent: pivotMessage.content_json,
    nextContent: buildUserMessageContent({
      message: pivotMessageText,
      tools: loadMessageTools(pivotMessage.content_json.tools),
      agent: await loadVisibleAgentSelection(request.user.id, pivotMessage.content_json.agent)
    }),
    interruptQueued: true
  });

  await recordPromptUsageIfRequired({
    taskId: params.taskId,
    taskMessageId: run.messageId,
    userId: request.user.id,
    mode: entitlement.mode
  });

  return run;
}

async function handleContinueTaskMessage(request: FastifyRequest, reply: FastifyReply) {
  const params = taskMessageParams.parse(request.params);
  const access = await assertTaskMember(params.taskId, request.user.id);
  await ensureTaskHistoryWarm(params.taskId);
  const entitlement = await getPromptEntitlementStatus(request.user.id);

  if (!entitlement.allowed) {
    return reply.status(429).send(buildEntitlementExceededPayload(entitlement));
  }

  const targetMessageRes = await query<{ id: string; role: string }>(
    `SELECT id, role
       FROM task_messages
      WHERE task_id = $1
        AND id = $2`,
    [params.taskId, params.messageId]
  );
  if ((targetMessageRes.rowCount ?? 0) === 0) {
    throw new Error("Message not found");
  }
  if (targetMessageRes.rows[0].role !== "assistant") {
    return reply.status(409).send({ error: "Only assistant messages can be continued." });
  }

  const sourceUserMessage = await findNearestUserAncestorMessage(params.taskId, params.messageId);
  const run = await appendTaskUserMessageAndEnqueue({
    taskId: params.taskId,
    workspaceId: access.workspaceId,
    environmentId: access.environmentId,
    triggerSource: "web",
    message: CONTINUE_TASK_PROMPT,
    tools: loadMessageTools(sourceUserMessage?.content_json.tools),
    agent: await loadVisibleAgentSelection(request.user.id, sourceUserMessage?.content_json.agent),
    userId: request.user.id,
    parentMessageId: params.messageId,
    interruptQueued: true
  });

  await recordPromptUsageIfRequired({
    userId: request.user.id,
    mode: entitlement.mode,
    taskId: params.taskId,
    taskMessageId: run.messageId
  });

  return buildAppendMessageResponse(run);
}

async function handleEditTaskMessage(request: FastifyRequest, reply: FastifyReply) {
  const params = taskMessageParams.parse(request.params);
  const body = editTaskMessageBody.parse(request.body);
  const access = await assertTaskMember(params.taskId, request.user.id);
  await ensureTaskHistoryWarm(params.taskId);
  const entitlement = await getPromptEntitlementStatus(request.user.id);

  if (!entitlement.allowed) {
    return reply.status(429).send(buildEntitlementExceededPayload(entitlement));
  }

  const nextMessage = (body.message ?? body.content ?? "").trim();
  if (nextMessage.length === 0) {
    throw new Error("message is required");
  }

  const selectedAgent = await requireVisiblePlatformAgentSelectionForUser(request.user.id, body.agent);
  const messageRes = await query<{
    id: string;
    role: string;
    content_json: Record<string, unknown>;
    parent_message_id: string | null;
  }>(
    `SELECT id, role, content_json, parent_message_id
       FROM task_messages
      WHERE task_id = $1
        AND id = $2`,
    [params.taskId, params.messageId]
  );
  if ((messageRes.rowCount ?? 0) === 0) {
    throw new Error("Message not found");
  }
  if (messageRes.rows[0].role !== "user") {
    throw new Error("Only user messages can be edited");
  }

  const run = await replaceTaskMessageAndEnqueue({
    taskId: params.taskId,
    workspaceId: access.workspaceId,
    environmentId: access.environmentId,
    triggerSource: "web",
    userId: request.user.id,
    sourceMessageId: params.messageId,
    parentMessageId: messageRes.rows[0].parent_message_id,
    oldContent: messageRes.rows[0].content_json,
    nextContent: buildUserMessageContent({
      message: nextMessage,
      attachments: body.attachments,
      tools: body.tools,
      agent: selectedAgent
    }),
    interruptQueued: true
  });

  await recordPromptUsageIfRequired({
    taskId: params.taskId,
    taskMessageId: run.messageId,
    userId: request.user.id,
    mode: entitlement.mode
  });

  return run;
}

export async function registerTaskMessageRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/tasks/:taskId/messages", { preHandler: fastify.authenticate }, handlePostTaskMessage);
  fastify.post("/api/tasks/:taskId/branch-selection", { preHandler: fastify.authenticate }, handleBranchSelection);
  fastify.post(
    "/api/tasks/:taskId/messages/:messageId/retry",
    { preHandler: fastify.authenticate },
    handleRetryTaskMessage
  );
  fastify.post(
    "/api/tasks/:taskId/messages/:messageId/continue",
    { preHandler: fastify.authenticate },
    handleContinueTaskMessage
  );
  fastify.post(
    "/api/tasks/:taskId/messages/:messageId/edit",
    { preHandler: fastify.authenticate },
    handleEditTaskMessage
  );
}
