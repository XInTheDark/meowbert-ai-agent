import type { FastifyInstance } from "fastify";
import { assertWorkspaceMember } from "../../services/workspaces/workspace-access.js";
import {
  WorkspaceMemberNotFoundError,
  WorkspaceMemberOwnerLeaveError,
  WorkspaceMemberOwnerRemovalError,
  WorkspaceMemberSelfRemovalError,
  leaveWorkspace,
  listWorkspaceMembers,
  removeWorkspaceMember
} from "../../services/workspaces/workspace-members.js";
import {
  isWorkspaceOwner,
  workspaceMemberCreateSchema,
  workspaceMemberParamsSchema,
  workspaceParamsSchema
} from "./shared.js";

export async function registerWorkspaceMemberRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/workspaces/:wsId/members", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    await assertWorkspaceMember(params.wsId, request.user.id);

    return {
      items: await listWorkspaceMembers(params.wsId)
    };
  });

  fastify.delete(
    "/api/workspaces/:wsId/membership",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = workspaceParamsSchema.parse(request.params);
      await assertWorkspaceMember(params.wsId, request.user.id);

      try {
        const removed = await leaveWorkspace({
          workspaceId: params.wsId,
          userId: request.user.id
        });

        return {
          ok: true,
          removed
        };
      } catch (error) {
        if (error instanceof WorkspaceMemberNotFoundError) {
          return reply.status(404).send({ error: "Workspace member not found" });
        }

        if (error instanceof WorkspaceMemberOwnerLeaveError) {
          return reply.status(400).send({ error: error.message });
        }

        throw error;
      }
    }
  );

  fastify.post("/api/workspaces/:wsId/members", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    const body = workspaceMemberCreateSchema.parse(request.body);
    await assertWorkspaceMember(params.wsId, request.user.id);

    if (!(await isWorkspaceOwner(params.wsId, request.user.id))) {
      return reply.status(403).send({ error: "Only owners can manage workspace members" });
    }

    const { inviteWorkspaceUserByEmail, WorkspaceInviteUserNotFoundError } = await import(
      "../../services/workspaces/workspace-invites.js"
    );

    try {
      const result = await inviteWorkspaceUserByEmail({
        workspaceId: params.wsId,
        invitedByUserId: request.user.id,
        email: body.email
      });

      return reply.status(result.outcome === "invited" ? 201 : 200).send(result);
    } catch (error) {
      if (error instanceof WorkspaceInviteUserNotFoundError) {
        return reply.status(404).send({ error: "No registered user exists with that email address" });
      }

      throw error;
    }
  });

  fastify.delete(
    "/api/workspaces/:wsId/members/:userId",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = workspaceMemberParamsSchema.parse(request.params);
      await assertWorkspaceMember(params.wsId, request.user.id);

      if (!(await isWorkspaceOwner(params.wsId, request.user.id))) {
        return reply.status(403).send({ error: "Only owners can manage workspace members" });
      }

      try {
        const removed = await removeWorkspaceMember({
          workspaceId: params.wsId,
          actorUserId: request.user.id,
          targetUserId: params.userId
        });

        return {
          ok: true,
          removed
        };
      } catch (error) {
        if (error instanceof WorkspaceMemberNotFoundError) {
          return reply.status(404).send({ error: "Workspace member not found" });
        }

        if (error instanceof WorkspaceMemberSelfRemovalError || error instanceof WorkspaceMemberOwnerRemovalError) {
          return reply.status(400).send({ error: error.message });
        }

        throw error;
      }
    }
  );
}
