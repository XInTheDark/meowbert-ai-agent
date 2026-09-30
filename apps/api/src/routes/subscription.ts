import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import OpenAI from "openai";
import { assertSafePublicUrl } from "@meowbert/shared/server-security";
import {
  getUserByoConfig,
  getUserFreeMessageUsage,
  getUserMonthlyWeightedTokenUsage,
  getUserSubscriptionUsageLimits,
  listUserAssignedSubscriptionPlans,
  resolveUserAccessMode,
  resolveUserFreeMessageLimit,
  updateUserByoConfig
} from "../services/billing/subscriptions.js";

const updateByoSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["openai_compatible", "chatgpt_oauth"]).optional(),
  baseUrl: z.string().url().nullable().optional(),
  model: z.string().min(1).max(300).nullable().optional(),
  apiKey: z.string().min(1).max(1000).nullable().optional()
});

const fetchByoModelsSchema = z
  .object({
    baseUrl: z.string().url().optional(),
    apiKey: z.string().min(1).optional()
  })
  .optional();

export const subscriptionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/subscription", { preHandler: fastify.authenticate }, async (request) => {
    const [mode, monthlyUsage, usageLimits, freeLimit, freeUsed, plans, byo] = await Promise.all([
      resolveUserAccessMode(request.user.id),
      getUserMonthlyWeightedTokenUsage(request.user.id),
      getUserSubscriptionUsageLimits(request.user.id),
      resolveUserFreeMessageLimit(request.user.id),
      getUserFreeMessageUsage(request.user.id),
      listUserAssignedSubscriptionPlans(request.user.id),
      getUserByoConfig(request.user.id)
    ]);

    return {
      mode,
      monthStartUtc: monthlyUsage.monthStartUtc,
      monthEndUtc: monthlyUsage.monthEndUtc,
      usage: {
        weightedTokensUsed: monthlyUsage.weightedTokensUsed,
        weightedTokensLimit: monthlyUsage.weightedTokensLimit,
        weightedTokensRemaining: monthlyUsage.weightedTokensRemaining,
        limits: usageLimits.limits,
        freeMessagesUsed: freeUsed,
        freeMessageLimit: freeLimit,
        freeMessagesRemaining: freeLimit === null ? null : Math.max(0, freeLimit - freeUsed)
      },
      plans,
      byo
    };
  });

  fastify.patch("/api/subscription/byo", { preHandler: fastify.authenticate }, async (request) => {
    const body = updateByoSchema.parse(request.body);

    const updated = await updateUserByoConfig({
      userId: request.user.id,
      enabled: body.enabled,
      provider: body.provider,
      baseUrl: body.baseUrl,
      model: body.model,
      apiKey: body.apiKey
    });

    return {
      byo: updated
    };
  });

  fastify.post("/api/subscription/byo/models", { preHandler: fastify.authenticate }, async (request, reply) => {
    const body = fetchByoModelsSchema.parse(request.body ?? {});
    const existing = await getUserByoConfig(request.user.id, { includeApiKey: true });

    const baseUrl = (body?.baseUrl ?? existing.baseUrl ?? "").trim();
    const apiKey = (body?.apiKey ?? existing.apiKey ?? "").trim();

    if (!baseUrl || !apiKey) {
      return reply.status(400).send({ error: "Base URL and API key are required to fetch models." });
    }

    try {
      await assertSafePublicUrl(baseUrl, "BYO base URL");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }

    try {
      const client = new OpenAI({
        apiKey,
        baseURL: baseUrl
      });
      const modelsResponse = await client.models.list();
      const models = modelsResponse.data.map((entry) => entry.id).filter((id) => typeof id === "string").sort();

      return {
        models
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(502).send({ error: `Failed to fetch models from provider: ${message}` });
    }
  });
};
