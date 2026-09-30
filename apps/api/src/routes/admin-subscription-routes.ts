import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import {
  createSubscriptionPlan,
  listSubscriptionPlans,
  updateSubscriptionPlan
} from "../services/billing/subscriptions.js";

const createSubscriptionPlanSchema = z.object({
  name: z.string().min(1).max(120),
  monthlyTokenQuota: z.number().int().min(0).optional(),
  usageLimits: z.array(z.object({
    weightedTokens: z.number().int().min(1),
    durationDays: z.number().int().min(1)
  })).max(20).optional(),
  notes: z.string().max(2000).nullable().optional(),
  workspaceLimit: z.number().int().min(1).nullable().optional(),
  sandboxPidsLimit: z.number().int().min(1).nullable().optional(),
  sandboxMemoryMb: z.number().int().min(1).nullable().optional(),
  sandboxCpus: z.number().positive().nullable().optional(),
  workspaceStorageMb: z.number().int().min(1).nullable().optional(),
  persistentRuntimeComputeCredits: z.number().int().min(0).nullable().optional(),
  persistentRuntimeLimit: z.number().int().min(0).nullable().optional(),
  agentIds: z.array(z.string().min(1).max(240)).max(100).optional(),
  isActive: z.boolean().optional()
});

const updateSubscriptionPlanSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  monthlyTokenQuota: z.number().int().min(0).optional(),
  usageLimits: z.array(z.object({
    weightedTokens: z.number().int().min(1),
    durationDays: z.number().int().min(1)
  })).max(20).optional(),
  notes: z.string().max(2000).nullable().optional(),
  workspaceLimit: z.number().int().min(1).nullable().optional(),
  sandboxPidsLimit: z.number().int().min(1).nullable().optional(),
  sandboxMemoryMb: z.number().int().min(1).nullable().optional(),
  sandboxCpus: z.number().positive().nullable().optional(),
  workspaceStorageMb: z.number().int().min(1).nullable().optional(),
  persistentRuntimeComputeCredits: z.number().int().min(0).nullable().optional(),
  persistentRuntimeLimit: z.number().int().min(0).nullable().optional(),
  agentIds: z.array(z.string().min(1).max(240)).max(100).optional(),
  isActive: z.boolean().optional()
});

export function registerAdminSubscriptionRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/admin/subscriptions/plans", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const plans = await listSubscriptionPlans();
    return { plans };
  });

  fastify.post("/api/admin/subscriptions/plans", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const body = createSubscriptionPlanSchema.parse(request.body);
    const plan = await createSubscriptionPlan(body);
    return { plan };
  });

  fastify.patch("/api/admin/subscriptions/plans/:planId", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { planId } = request.params as { planId: string };
    const body = updateSubscriptionPlanSchema.parse(request.body);
    const plan = await updateSubscriptionPlan({
      planId,
      ...body
    });
    return { plan };
  });

}
