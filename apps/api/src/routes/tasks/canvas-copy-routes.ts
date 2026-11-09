import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { copyTaskCanvasToProject } from "../../services/canvases/copy-task-canvas.js";
import { getEnvironmentForUser } from "../../services/environments/environment-for-user.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";

const params = z.object({ taskId: z.string().uuid() });
const body = z.object({
  relativePath: z.string().trim().min(1).max(600),
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).nullable().optional()
}).strict();

export async function registerTaskCanvasCopyRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/tasks/:taskId/canvases/copy-to-project", { preHandler: fastify.authenticate }, async (request, reply) => {
    const { taskId } = params.parse(request.params);
    const input = body.parse(request.body ?? {});
    const task = await assertTaskMember(taskId, request.user.id);
    const project = await getEnvironmentForUser(input.projectId, request.user.id);
    const canvas = await copyTaskCanvasToProject({
      taskId,
      taskEnvironmentId: task.environmentId,
      relativePath: input.relativePath,
      name: input.name ?? null,
      createdByUserId: request.user.id,
      project
    });
    return reply.status(201).send({ canvas });
  });
}
