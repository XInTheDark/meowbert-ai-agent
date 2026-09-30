import type { FastifyPluginAsync } from "fastify";
import { registerWorkspaceCoreRoutes } from "./workspaces/core-routes.js";
import { registerWorkspaceInviteRoutes } from "./workspaces/invite-routes.js";
import { registerWorkspaceMemberRoutes } from "./workspaces/member-routes.js";
import { registerWorkspaceSettingsAuxRoutes } from "./workspaces/settings-routes.js";
import { registerWorkspaceMemoryRoutes } from "./workspaces/memory-routes.js";

export const workspaceRoutes: FastifyPluginAsync = async (fastify) => {
  await registerWorkspaceCoreRoutes(fastify);
  await registerWorkspaceMemberRoutes(fastify);
  await registerWorkspaceInviteRoutes(fastify);
  await registerWorkspaceSettingsAuxRoutes(fastify);
  await registerWorkspaceMemoryRoutes(fastify);
};
