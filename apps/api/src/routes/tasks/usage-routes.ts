import type { FastifyInstance, FastifyRequest } from "fastify";
import type { TaskUsageResponse } from "@meowbert/shared";
import { getTaskUsageSummary } from "../../services/tasks/task-usage.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { taskParams } from "./shared.js";

async function handleGetTaskUsage(request: FastifyRequest): Promise<TaskUsageResponse> {
  const params = taskParams.parse(request.params);
  await assertTaskMember(params.taskId, request.user.id);
  return { usage: await getTaskUsageSummary(params.taskId) };
}

export async function registerTaskUsageRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/tasks/:taskId/usage", { preHandler: fastify.authenticate }, handleGetTaskUsage);
}
