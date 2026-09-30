import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import {
  listAdminHostStorageOverview,
  pruneAdminTaskEvents,
  queueAdminTaskHistoryArchive,
  vacuumFullAdminTaskEvents
} from "../services/storage/admin-host-storage.js";
import {
  TASK_HISTORY_WARM_RETENTION_DAYS_MAX,
  updateAdminTaskHistoryWarmRetentionDays
} from "../services/storage/admin-storage.js";

const updateTaskHistoryArchiveSchema = z.object({
  warmRetentionDays: z.number().int().min(0).max(TASK_HISTORY_WARM_RETENTION_DAYS_MAX)
});

const vacuumFullTaskEventsSchema = z.object({
  confirmation: z.literal("VACUUM FULL task_events")
});

export function registerAdminHostStorageRoutes(
  fastify: Parameters<FastifyPluginAsync>[0]
): void {
  fastify.get("/api/admin/host-storage", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return {
      hostStorage: await listAdminHostStorageOverview()
    };
  });

  fastify.post("/api/admin/host-storage/events/prune", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return pruneAdminTaskEvents();
  });

  fastify.post("/api/admin/host-storage/events/vacuum-full", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    vacuumFullTaskEventsSchema.parse(request.body);
    return {
      result: await vacuumFullAdminTaskEvents()
    };
  });

  fastify.patch("/api/admin/host-storage/task-history", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const body = updateTaskHistoryArchiveSchema.parse(request.body);
    const warmRetentionDays = await updateAdminTaskHistoryWarmRetentionDays({
      warmRetentionDays: body.warmRetentionDays
    });
    return { warmRetentionDays };
  });

  fastify.post("/api/admin/host-storage/task-history/archive", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return {
      run: await queueAdminTaskHistoryArchive({
        requestedByUserId: request.user.id
      })
    };
  });
}
