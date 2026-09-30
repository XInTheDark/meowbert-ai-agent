import { registerTaskNavigationRoutes } from "./tasks/navigation-routes.js";
import type { FastifyPluginAsync } from "fastify";
import { registerTaskCreateRoutes } from "./tasks/create-routes.js";
import { registerTaskDebugRoutes } from "./tasks/debug-routes.js";
import { registerTaskDetailRoutes } from "./tasks/detail-routes.js";
import { registerTaskEventRoutes } from "./tasks/event-routes.js";
import { registerTaskInlineFileRoutes } from "./tasks/inline-file-routes.js";
import { registerTaskLifecycleRoutes } from "./tasks/lifecycle-routes.js";
import { registerTaskMessageRoutes } from "./tasks/message-routes.js";
import { registerTaskScheduleRoutes } from "./tasks/schedule-routes.js";
import { registerTaskSharingRoutes } from "./tasks/sharing-routes.js";
import { registerTaskThreadRoutes } from "./tasks/thread-routes.js";
import { registerTaskWorkflowRoutes } from "./tasks/workflow-routes.js";

export const taskRoutes: FastifyPluginAsync = async (fastify) => {
  await registerTaskCreateRoutes(fastify);
  await registerTaskDetailRoutes(fastify);
  await registerTaskNavigationRoutes(fastify);
  await registerTaskThreadRoutes(fastify);
  await registerTaskSharingRoutes(fastify);
  await registerTaskWorkflowRoutes(fastify);
  await registerTaskDebugRoutes(fastify);
  await registerTaskMessageRoutes(fastify);
  await registerTaskLifecycleRoutes(fastify);
  await registerTaskScheduleRoutes(fastify);
  await registerTaskEventRoutes(fastify);
  await registerTaskInlineFileRoutes(fastify);
};
