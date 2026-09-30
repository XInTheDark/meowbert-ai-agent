import type { FastifyInstance } from "fastify";
import { assertWorkspaceMember } from "../../services/workspaces/workspace-access.js";
import {
  WorkspaceInviteNotFoundError,
  acceptWorkspaceInvite,
  getPendingWorkspaceInviteDetail,
  listPendingWorkspaceInvitesForUser,
  listWorkspaceInvites,
  rejectWorkspaceInvite,
  revokeWorkspaceInvite
} from "../../services/workspaces/workspace-invites.js";
import {
  inviteDecisionParamsSchema,
  isWorkspaceOwner,
  workspaceInviteParamsSchema,
  workspaceParamsSchema
} from "./shared.js";

export async function registerWorkspaceInviteRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/workspaces/:wsId/invites", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    await assertWorkspaceMember(params.wsId, request.user.id);

    if (!(await isWorkspaceOwner(params.wsId, request.user.id))) {
      return reply.status(403).send({ error: "Only owners can manage workspace members" });
    }

    return {
      items: await listWorkspaceInvites(params.wsId)
    };
  });

  fastify.delete(
    "/api/workspaces/:wsId/invites/:inviteId",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = workspaceInviteParamsSchema.parse(request.params);
      await assertWorkspaceMember(params.wsId, request.user.id);

      if (!(await isWorkspaceOwner(params.wsId, request.user.id))) {
        return reply.status(403).send({ error: "Only owners can manage workspace members" });
      }

      try {
        const removed = await revokeWorkspaceInvite({
          workspaceId: params.wsId,
          inviteId: params.inviteId
        });

        return {
          ok: true,
          removed
        };
      } catch (error) {
        if (error instanceof WorkspaceInviteNotFoundError) {
          return reply.status(404).send({ error: "Workspace invite not found" });
        }

        throw error;
      }
    }
  );

  fastify.get("/api/workspace-invites", { preHandler: fastify.authenticate }, async (request) => ({
    items: await listPendingWorkspaceInvitesForUser(request.user.id)
  }));

  fastify.get("/api/workspace-invites/:inviteId", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = inviteDecisionParamsSchema.parse(request.params);

    try {
      return await getPendingWorkspaceInviteDetail({
        inviteId: params.inviteId,
        userId: request.user.id
      });
    } catch (error) {
      if (error instanceof WorkspaceInviteNotFoundError) {
        return reply.status(404).send({ error: "Workspace invite not found" });
      }

      throw error;
    }
  });

  fastify.post(
    "/api/workspace-invites/:inviteId/accept",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = inviteDecisionParamsSchema.parse(request.params);

      try {
        return await acceptWorkspaceInvite({
          inviteId: params.inviteId,
          userId: request.user.id
        });
      } catch (error) {
        if (error instanceof WorkspaceInviteNotFoundError) {
          return reply.status(404).send({ error: "Workspace invite not found" });
        }

        throw error;
      }
    }
  );

  fastify.post(
    "/api/workspace-invites/:inviteId/reject",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = inviteDecisionParamsSchema.parse(request.params);

      try {
        return await rejectWorkspaceInvite({
          inviteId: params.inviteId,
          userId: request.user.id
        });
      } catch (error) {
        if (error instanceof WorkspaceInviteNotFoundError) {
          return reply.status(404).send({ error: "Workspace invite not found" });
        }

        throw error;
      }
    }
  );
}
