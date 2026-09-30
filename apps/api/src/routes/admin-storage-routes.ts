import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import {
  listAdminStorageOverview,
  queueBulkWorkspaceStorageMigration,
  queueWorkspaceStorageMigration,
  searchAdminStorageUsers,
  testAdminStorageBackend,
  updateAdminStorageDefaultBackend,
  updateAdminTaskHistoryWarmRetentionDays,
  TASK_HISTORY_WARM_RETENTION_DAYS_MAX
} from "../services/storage/admin-storage.js";

const storageWorkspaceParamsSchema = z.object({
  wsId: z.string().uuid()
});

const updateAdminStorageDefaultSchema = z.object({
  backendId: z.string().min(1).max(120)
});

const updateTaskHistoryArchiveSchema = z.object({
  warmRetentionDays: z.number().int().min(0).max(TASK_HISTORY_WARM_RETENTION_DAYS_MAX)
});

const storageBackendParamsSchema = z.object({
  backendId: z.string().min(1).max(120)
});

const queueWorkspaceStorageMigrationSchema = z.object({
  targetBackendId: z.string().min(1).max(120)
});

const queueBulkWorkspaceStorageMigrationSchema = z.object({
  targetBackendId: z.string().min(1).max(120)
});

const adminStorageQuerySchema = z.object({
  ownerUserId: z.string().uuid().optional()
});

const searchAdminStorageUsersSchema = z.object({
  search: z.string().trim().min(1).max(320),
  limit: z.coerce.number().min(1).max(20).default(10)
});

export function registerAdminStorageRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/admin/storage", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const query = adminStorageQuerySchema.parse(request.query);
    return {
      storage: await listAdminStorageOverview({
        ownerUserId: query.ownerUserId
      })
    };
  });

  fastify.get("/api/admin/storage/users", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const query = searchAdminStorageUsersSchema.parse(request.query);
    return {
      users: await searchAdminStorageUsers({
        search: query.search,
        limit: query.limit
      })
    };
  });

  fastify.post("/api/admin/storage/backends/:backendId/test", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const params = storageBackendParamsSchema.parse(request.params);
    return {
      backend: await testAdminStorageBackend({
        backendId: params.backendId
      })
    };
  });

  fastify.patch("/api/admin/storage/default-backend", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const body = updateAdminStorageDefaultSchema.parse(request.body);
    const backendId = await updateAdminStorageDefaultBackend({ backendId: body.backendId });
    return { backendId };
  });

  fastify.patch("/api/admin/storage/task-history", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const body = updateTaskHistoryArchiveSchema.parse(request.body);
    const warmRetentionDays = await updateAdminTaskHistoryWarmRetentionDays({
      warmRetentionDays: body.warmRetentionDays
    });
    return { warmRetentionDays };
  });

  fastify.post("/api/admin/storage/migrations/bulk", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const body = queueBulkWorkspaceStorageMigrationSchema.parse(request.body);
    return queueBulkWorkspaceStorageMigration({
      targetBackendId: body.targetBackendId,
      requestedByUserId: request.user.id
    });
  });

  fastify.post("/api/admin/storage/workspaces/:wsId/migrate", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const params = storageWorkspaceParamsSchema.parse(request.params);
    const body = queueWorkspaceStorageMigrationSchema.parse(request.body);
    return {
      migration: await queueWorkspaceStorageMigration({
        workspaceId: params.wsId,
        targetBackendId: body.targetBackendId,
        requestedByUserId: request.user.id
      })
    };
  });
}
