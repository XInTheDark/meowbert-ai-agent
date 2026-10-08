import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  AGENT_SWARM_MAX_TIME_BUDGET_MINUTES,
  AGENT_SWARM_MAX_TOKEN_BUDGET,
  AGENT_SWARM_MAX_WORKERS
} from "@meowbert/shared";
import { listAdminProcesses } from "../services/admin/admin-processes.js";
import {
  getAdminUsageStatistics,
  type AdminStatisticsBucket,
  type AdminStatisticsRange
} from "../services/admin/admin-statistics.js";
import {
  assertSuperAdmin,
  getAdminSettings,
  updateAdminSettings
} from "../services/admin/admin-settings.js";
import { parseCsvList, parseUuidCsvList } from "./admin-query-params.js";

const agentPresetSchema = z.object({
  id: z.string().min(1).max(240),
  name: z.string().min(1).max(240),
  description: z.string().min(1).max(240),
  requiresSuperAdmin: z.boolean().default(false),
  hidden: z.boolean().optional(),
  spawnableAsNode: z.boolean().optional(),
  payload: z.record(z.string(), z.unknown()),
  mode: z.enum(["standard", "agent_swarm", "quality_control_reviewer"]).optional(),
  leaderAgentId: z.string().min(1).max(240).optional(),
  modelAllocations: z.array(z.object({
    agentId: z.string().min(1).max(240),
    workerCount: z.number().int().min(1).max(AGENT_SWARM_MAX_WORKERS)
  }).strict()).max(20).optional(),
  reviewRounds: z.number().int().min(0).max(10).optional(),
  tokenBudget: z.number().int().positive().max(AGENT_SWARM_MAX_TOKEN_BUDGET).optional(),
  timeBudgetMinutes: z.number().int().positive().max(AGENT_SWARM_MAX_TIME_BUDGET_MINUTES).optional(),
  disableSpawningAndBudgets: z.boolean().optional()
});

const modelMetadataSchema = z.record(z.string(), z.record(z.string(), z.unknown()));
const specializedModelsSchema = z.object({
  internalModel: z.string().min(1).max(240).nullable().default(null),
  fastModel: z.string().min(1).max(240).nullable(),
  memorySynthesisAgent: z.string().min(1).max(240).nullable(),
  reviewerAgent: z.string().min(1).max(240).nullable(),
  subagentFastAgent: z.string().min(1).max(240).nullable().default(null)
});
const modelSliderAgentIdsSchema = z.array(z.string().trim().min(1).max(240)).max(100);
const modelRouterTargetSchema = z.object({
  id: z.string().min(1).max(240),
  description: z.string().min(1).max(4_000),
  payload: z.object({
    model: z.string().min(1).max(240)
  }).catchall(z.unknown())
});
const modelRouterSchema = z.object({
  id: z.string().min(1).max(240),
  routingModel: z.string().min(1).max(240),
  defaultTargetModel: z.string().min(1).max(240),
  allowQuickMode: z.boolean().default(false),
  models: z.array(modelRouterTargetSchema).min(1).max(50)
});

const updateAdminSettingsSchema = z.object({
  allowUserSignup: z.boolean(),
  requireAdminSignupApproval: z.boolean(),
  enableForgotPassword: z.boolean(),
  requireEmailVerificationOnSignup: z.boolean(),
  enablePromptCaching: z.boolean(),
  debugMode: z.boolean(),
  defaultFreeMessageLimit: z.number().int().min(0).nullable(),
  maxTaskRunRetries: z.number().int().min(0).max(100),
  taskScheduler: z.object({
    defaultEnvironmentConcurrency: z.number().int().positive(),
    maxWorkspaceConcurrency: z.number().int().positive(),
    maxQueuedAheadPerWorkspace: z.number().int().min(0),
    backgroundAgingMinutes: z.number().int().min(0)
  }),
  usageRateMultiplier: z.number().min(0),
  modelMetadata: modelMetadataSchema,
  modelRouters: z.array(modelRouterSchema).max(100),
  agentPresets: z.array(agentPresetSchema).min(1).max(100),
  specializedModels: specializedModelsSchema,
  modelSliderAgentIds: modelSliderAgentIdsSchema
});

const adminStatisticsRangeSchema = z.enum(["24h", "7d", "30d", "90d", "custom"]);
const adminStatisticsBucketSchema = z.enum(["hour", "day", "week", "month"]);
const adminStatisticsQuerySchema = z.object({
  range: adminStatisticsRangeSchema.default("30d"),
  from: z.string().optional(),
  to: z.string().optional(),
  bucket: adminStatisticsBucketSchema.optional(),
  models: z.string().optional(),
  users: z.string().optional(),
  userSearch: z.string().trim().max(320).optional()
});

export function registerAdminCoreRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/admin/settings", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);

    const settings = await getAdminSettings();
    return { settings };
  });

  fastify.patch("/api/admin/settings", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);

    const body = updateAdminSettingsSchema.parse(request.body);
    const settings = await updateAdminSettings(body);

    return { settings };
  });

  fastify.get("/api/admin/processes", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return {
      processes: await listAdminProcesses()
    };
  });

  fastify.get("/api/admin/statistics/usage", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const parsed = adminStatisticsQuerySchema.parse(request.query);
    return {
      usage: await getAdminUsageStatistics({
        range: parsed.range as AdminStatisticsRange,
        from: parsed.from,
        to: parsed.to,
        bucket: parsed.bucket as AdminStatisticsBucket | undefined,
        models: parseCsvList(parsed.models, 40),
        users: parseUuidCsvList(parsed.users, 40),
        userSearch: parsed.userSearch
      })
    };
  });
}
