import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { verifyScopedAccessTicket } from "../services/auth/scoped-access-tickets.js";
import {
  cancelManagedTask,
  createManagedTask,
  messageManagedTask
} from "../services/project-master/managed-tasks.js";
import {
  isProjectMasterEnabledForWorkspace,
  loadProjectMasterByTaskId,
  ProjectMasterError,
  type ProjectMasterTask
} from "../services/project-master/master-task.js";
import { taskToolOptionsSchema } from "./tasks/shared.js";
import { extractBearerToken } from "./source-route-shared.js";

const masterParams = z.object({ masterTaskId: z.string().uuid() });
const targetParams = masterParams.extend({ taskId: z.string().uuid() });
const createBody = z.object({
  taskId: z.string().uuid(),
  title: z.string().max(240).nullable(),
  message: z.string().min(1),
  tools: taskToolOptionsSchema
});
const messageBody = z.object({ message: z.string().min(1) });

async function requireMasterAccess(
  fastify: FastifyInstance,
  request: FastifyRequest,
  masterTaskId: string
): Promise<{ master: ProjectMasterTask; userId: string }> {
  const payload = await verifyScopedAccessTicket(fastify, {
    ticket: extractBearerToken(request.headers.authorization),
    scope: "project_master_proxy",
    taskId: masterTaskId
  });
  const master = await loadProjectMasterByTaskId(masterTaskId);
  if (!master) {
    throw new ProjectMasterError("Project Master not found.", 404);
  }
  if (!(await isProjectMasterEnabledForWorkspace(master.workspaceId))) {
    throw new ProjectMasterError("Project Master is not enabled for this workspace.", 409);
  }
  return { master, userId: payload.userId };
}

export const projectMasterInternalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/api/internal/project-master/:masterTaskId/tasks", async (request) => {
    const params = masterParams.parse(request.params);
    const body = createBody.parse(request.body);
    const access = await requireMasterAccess(fastify, request, params.masterTaskId);
    return createManagedTask({ ...access, taskId: body.taskId, title: body.title, message: body.message, tools: body.tools });
  });

  fastify.post("/api/internal/project-master/:masterTaskId/tasks/:taskId/messages", async (request) => {
    const params = targetParams.parse(request.params);
    const body = messageBody.parse(request.body);
    const access = await requireMasterAccess(fastify, request, params.masterTaskId);
    return messageManagedTask({ ...access, taskId: params.taskId, message: body.message });
  });

  fastify.post("/api/internal/project-master/:masterTaskId/tasks/:taskId/cancel", async (request) => {
    const params = targetParams.parse(request.params);
    const access = await requireMasterAccess(fastify, request, params.masterTaskId);
    await cancelManagedTask({ master: access.master, taskId: params.taskId });
    return { ok: true };
  });
};
