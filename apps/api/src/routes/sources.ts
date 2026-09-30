import type { FastifyPluginAsync } from "fastify";
import { registerInternalSourceRoutes } from "./source-internal-routes.js";
import { registerSourceGoogleWorkspaceRoutes } from "./source-google-workspace-routes.js";
import { registerSourceOauthRoutes } from "./source-oauth-routes.js";
import { registerSourceOutlookRoutes } from "./source-outlook-routes.js";
import { registerWorkspaceSourceRoutes } from "./source-workspace-routes.js";

export const sourceRoutes: FastifyPluginAsync = async (fastify) => {
  registerSourceGoogleWorkspaceRoutes(fastify);
  registerSourceOutlookRoutes(fastify);
  registerWorkspaceSourceRoutes(fastify);
  registerSourceOauthRoutes(fastify);
  registerInternalSourceRoutes(fastify);
};
