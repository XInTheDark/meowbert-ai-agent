import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getSourceFileLinkStatusByEnvironmentPath,
  pullSourceFileLinkByEnvironmentPath,
  pushSourceFileLinkByEnvironmentPath,
  unlinkSourceFileLinkByEnvironmentPath
} from "../../services/source-file-links/service.js";
import { environmentParams, getEnvironmentForUser } from "./shared.js";

const liveSyncPathQuery = z.object({
  path: z.string().trim().min(1).max(1200)
});

const liveSyncMutationBody = z.object({
  path: z.string().trim().min(1).max(1200),
  force: z.boolean().optional()
}).strict();

const liveSyncUnlinkBody = z.object({
  path: z.string().trim().min(1).max(1200)
}).strict();

export async function registerEnvironmentLiveSyncRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/projects/:envId/files/live-sync", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const queryInput = liveSyncPathQuery.parse(request.query ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);

    return getSourceFileLinkStatusByEnvironmentPath({
      environmentId: environment.id,
      environmentRootPath: environment.root_path,
      localRelativePath: queryInput.path
    });
  });

  fastify.post("/api/projects/:envId/files/live-sync/pull", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const body = liveSyncMutationBody.parse(request.body ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);

    return pullSourceFileLinkByEnvironmentPath({
      environmentId: environment.id,
      environmentRootPath: environment.root_path,
      workspaceRootPath: environment.workspace_root_path,
      actorUserId: request.user.id,
      localRelativePath: body.path,
      force: body.force
    });
  });

  fastify.post("/api/projects/:envId/files/live-sync/push", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const body = liveSyncMutationBody.parse(request.body ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);

    return pushSourceFileLinkByEnvironmentPath({
      environmentId: environment.id,
      environmentRootPath: environment.root_path,
      actorUserId: request.user.id,
      localRelativePath: body.path,
      force: body.force
    });
  });

  fastify.post("/api/projects/:envId/files/live-sync/unlink", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = environmentParams.parse(request.params);
    const body = liveSyncUnlinkBody.parse(request.body ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);

    await unlinkSourceFileLinkByEnvironmentPath({
      environmentId: environment.id,
      localRelativePath: body.path
    });

    return reply.send({ ok: true });
  });
}
