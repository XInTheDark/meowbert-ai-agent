import type { FastifyPluginAsync } from "fastify";
import { registerEnvironmentCoreRoutes } from "./environments/core-routes.js";
import { registerEnvironmentCanvasRoutes } from "./environments/canvas-routes.js";
import { registerEnvironmentFileRoutes } from "./environments/file-routes.js";
import { registerEnvironmentLiveSyncRoutes } from "./environments/live-sync-routes.js";
import { registerEnvironmentMasterRoutes } from "./environments/master-routes.js";
import { registerEnvironmentPersistentShellRoutes } from "./environments/persistent-shell-routes.js";
import { registerEnvironmentTaskFolderRoutes } from "./environments/task-folder-routes.js";
import { registerEnvironmentTaskRoutes } from "./environments/task-routes.js";

export const projectRoutes: FastifyPluginAsync = async (fastify) => {
  await registerEnvironmentCoreRoutes(fastify);
  await registerEnvironmentCanvasRoutes(fastify);
  await registerEnvironmentTaskFolderRoutes(fastify);
  await registerEnvironmentTaskRoutes(fastify);
  await registerEnvironmentPersistentShellRoutes(fastify);
  await registerEnvironmentFileRoutes(fastify);
  await registerEnvironmentLiveSyncRoutes(fastify);
  await registerEnvironmentMasterRoutes(fastify);
};

export const environmentRoutes = projectRoutes;
