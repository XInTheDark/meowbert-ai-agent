import type { FastifyPluginAsync } from "fastify";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import { listAdminAiProviders } from "../services/admin/admin-ai-providers.js";
import {
  cancelMemoryReindex,
  getLatestMemoryReindexJob,
  getMemoryEmbeddingSettings,
  markMemoryIndexesForReembed,
  startMemoryReindex,
  updateMemoryEmbeddingSettings
} from "../services/admin/admin-memory-embeddings.js";

export function registerAdminMemoryEmbeddingRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/admin/memory-embeddings", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const [settings, providers, job] = await Promise.all([
      getMemoryEmbeddingSettings(),
      listAdminAiProviders(),
      getLatestMemoryReindexJob()
    ]);
    return { settings, providers, job };
  });

  fastify.put("/api/admin/memory-embeddings", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return { settings: await updateMemoryEmbeddingSettings(request.body as never) };
  });

  fastify.post("/api/admin/memory-embeddings/reembed", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return { settings: await markMemoryIndexesForReembed() };
  });

  fastify.get("/api/admin/memory-embeddings/reindex", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return { job: await getLatestMemoryReindexJob() };
  });

  fastify.post("/api/admin/memory-embeddings/reindex", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);
    return reply.code(202).send({ job: await startMemoryReindex(request.body as never, request.user.id) });
  });

  fastify.post("/api/admin/memory-embeddings/reindex/cancel", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return { job: await cancelMemoryReindex() };
  });
}
