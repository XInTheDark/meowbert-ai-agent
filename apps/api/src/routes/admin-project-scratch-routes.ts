import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { SCRATCH_PRIORITIES } from "@meowbert/shared";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import { getProjectScratchPriority, updateProjectScratchPriority } from "../services/storage/project-scratch-priority.js";

const paramsSchema = z.object({ projectId: z.string().uuid() });
const bodySchema = z.object({ scratchPriority: z.enum(SCRATCH_PRIORITIES) }).strict();

export function registerAdminProjectScratchRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/admin/projects/:projectId/scratch-priority", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return getProjectScratchPriority(paramsSchema.parse(request.params).projectId);
  });

  fastify.patch("/api/admin/projects/:projectId/scratch-priority", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { projectId } = paramsSchema.parse(request.params);
    return updateProjectScratchPriority(projectId, bodySchema.parse(request.body).scratchPriority);
  });
}
