import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import {
  listAdminRuntimeMigrations,
  queueAdminRuntimeMigration
} from "../services/admin/runtime-migrations.js";

const adminRuntimeMigrationKeySchema = z.enum(["nest_environment_roots", "provision_local_xfs_project_quotas"]);
const adminRuntimeMigrationParamsSchema = z.object({
  migrationKey: adminRuntimeMigrationKeySchema
});

export function registerAdminRuntimeMigrationRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/admin/migrations", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return {
      migrations: await listAdminRuntimeMigrations()
    };
  });

  fastify.post("/api/admin/migrations/:migrationKey/run", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const params = adminRuntimeMigrationParamsSchema.parse(request.params);
    return {
      migration: await queueAdminRuntimeMigration({
        migrationKey: params.migrationKey,
        requestedByUserId: request.user.id
      })
    };
  });
}
