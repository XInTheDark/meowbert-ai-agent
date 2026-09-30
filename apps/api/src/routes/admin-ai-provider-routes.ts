import type { FastifyPluginAsync } from "fastify";
import { aiProviderInputSchema } from "@meowbert/shared";
import { z } from "zod";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import {
  addAdminAiProvider,
  listAdminAiProviders,
  removeAdminAiProvider,
  selectAdminAiProvider
} from "../services/admin/admin-ai-providers.js";
import { ProviderModelListError, listProviderModels } from "../services/admin/admin-ai-provider-models.js";

const providerParams = z.object({ providerId: z.string().uuid() });

export function registerAdminAiProviderRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/admin/ai-providers", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return { providers: await listAdminAiProviders() };
  });

  fastify.post("/api/admin/ai-providers", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);
    const input = aiProviderInputSchema.parse(request.body);
    return reply.code(201).send({ providers: await addAdminAiProvider(input) });
  });

  fastify.post("/api/admin/ai-providers/models", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);
    const input = aiProviderInputSchema.parse(request.body);
    try {
      return { models: await listProviderModels(input) };
    } catch (error) {
      if (error instanceof ProviderModelListError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });

  fastify.post("/api/admin/ai-providers/:providerId/select", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { providerId } = providerParams.parse(request.params);
    return { providers: await selectAdminAiProvider(providerId) };
  });

  fastify.delete("/api/admin/ai-providers/:providerId", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { providerId } = providerParams.parse(request.params);
    return { providers: await removeAdminAiProvider(providerId) };
  });
}
