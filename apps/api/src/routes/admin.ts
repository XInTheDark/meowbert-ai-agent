import type { FastifyPluginAsync } from "fastify";
import { registerAdminAiProviderRoutes } from "./admin-ai-provider-routes.js";
import { registerAdminUsageActivationRoutes } from "./admin-usage-activation-routes.js";
import { registerAdminConnectorRoutes } from "./admin-connector-routes.js";
import { registerAdminCoreRoutes } from "./admin-core-routes.js";
import { registerAdminHostStorageRoutes } from "./admin-host-storage-routes.js";
import { registerAdminNewsletterRoutes } from "./admin-newsletter-routes.js";
import { registerAdminRuntimeMigrationRoutes } from "./admin-runtime-migration-routes.js";
import { registerAdminStorageRoutes } from "./admin-storage-routes.js";
import { registerAdminSubscriptionRoutes } from "./admin-subscription-routes.js";
import { registerAdminUserRoutes } from "./admin-user-routes.js";

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  registerAdminCoreRoutes(fastify);
  registerAdminAiProviderRoutes(fastify);
  registerAdminUsageActivationRoutes(fastify);
  registerAdminHostStorageRoutes(fastify);
  registerAdminStorageRoutes(fastify);
  registerAdminRuntimeMigrationRoutes(fastify);
  registerAdminNewsletterRoutes(fastify);
  registerAdminSubscriptionRoutes(fastify);
  registerAdminConnectorRoutes(fastify);
  registerAdminUserRoutes(fastify);
};
