import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { ensureTaskHistoryWarm } from "../../services/tasks/task-history.js";
import { getTaskWorkflowOverview, listSwarmChannelMessages, listSwarmChannels } from "../../services/tasks/task-workflows.js";
import { taskChannelParams, taskParams } from "./shared.js";

async function isSwarmWorkflow(taskId: string): Promise<boolean> {
  const workflow = await getTaskWorkflowOverview(taskId);
  return Boolean(workflow && workflow.type === "agent_swarm");
}

async function handleListWorkflowChannels(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  await assertTaskMember(params.taskId, request.user.id);
  if (!(await isSwarmWorkflow(params.taskId))) {
    return reply.status(404).send({ error: "Swarm workflow not found" });
  }
  return { items: await listSwarmChannels(params.taskId) };
}

async function handleListWorkflowChannelMessages(request: FastifyRequest, reply: FastifyReply) {
  const params = taskChannelParams.parse(request.params);
  await assertTaskMember(params.taskId, request.user.id);
  if (!(await isSwarmWorkflow(params.taskId))) {
    return reply.status(404).send({ error: "Swarm workflow not found" });
  }
  await ensureTaskHistoryWarm(params.taskId);
  return { items: await listSwarmChannelMessages(params.taskId, params.channelId) };
}

export async function registerTaskWorkflowRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/tasks/:taskId/workflow/channels", { preHandler: fastify.authenticate }, handleListWorkflowChannels);
  fastify.get(
    "/api/tasks/:taskId/workflow/channels/:channelId/messages",
    { preHandler: fastify.authenticate },
    handleListWorkflowChannelMessages
  );
}
