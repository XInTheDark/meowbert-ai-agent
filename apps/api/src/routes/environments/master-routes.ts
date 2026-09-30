import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ensureProjectMasterTask,
  getProjectMasterTaskId,
  isProjectMasterEnabledForWorkspace
} from "../../services/project-master/master-task.js";
import { normalizeTimezoneOrThrow } from "../../services/tasks/task-schedule-config.js";
import { assertEnvironmentMember } from "../../services/workspaces/workspace-access.js";
import { environmentEntityPaths, environmentParams } from "./shared.js";

const ensureMasterBody = z.object({
  clientTimezone: z.string().min(1).max(120).optional()
});

async function handleGetMaster(request: FastifyRequest) {
  const params = environmentParams.parse(request.params);
  const access = await assertEnvironmentMember(params.envId, request.user.id);
  return {
    enabled: await isProjectMasterEnabledForWorkspace(access.workspaceId),
    taskId: await getProjectMasterTaskId(params.envId)
  };
}

async function handleEnsureMaster(request: FastifyRequest) {
  const params = environmentParams.parse(request.params);
  const body = ensureMasterBody.parse(request.body ?? {});
  const access = await assertEnvironmentMember(params.envId, request.user.id);
  const taskId = await ensureProjectMasterTask({
    environmentId: params.envId,
    workspaceId: access.workspaceId,
    userId: request.user.id,
    timezone: normalizeTimezoneOrThrow(body.clientTimezone)
  });
  return { taskId };
}

export async function registerEnvironmentMasterRoutes(fastify: FastifyInstance): Promise<void> {
  for (const environmentPath of environmentEntityPaths) {
    fastify.get(`${environmentPath}/master`, { preHandler: fastify.authenticate }, handleGetMaster);
    fastify.post(`${environmentPath}/master`, { preHandler: fastify.authenticate }, handleEnsureMaster);
  }
}
