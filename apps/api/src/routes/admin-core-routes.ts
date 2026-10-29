import type { FastifyPluginAsync } from "fastify";
import { loadAgentSwarmOutcomes } from "../services/agent-swarm/outcomes.js";
import { z } from "zod";
import {
  normalizeAgentSwarmAdvancedSettings,
  AGENT_SWARM_SPAWN_EFFORT_MAX,
  AGENT_SWARM_SPAWN_EFFORT_MIN,
  AGENT_SWARM_ADVANCED_RANGES,
  AGENT_SWARM_MAX_TIME_BUDGET_MINUTES,
  AGENT_SWARM_MAX_TOKEN_BUDGET
} from "@meowbert/shared";
import { listAdminProcesses } from "../services/admin/admin-processes.js";
import { listRecentMemoryRefreshes } from "../services/admin/admin-memory-refreshes.js";
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

function advancedInteger(field: keyof typeof AGENT_SWARM_ADVANCED_RANGES) {
  const range = AGENT_SWARM_ADVANCED_RANGES[field];
  return z.number().int().min(range.min).max(range.max);
}

// Agent Swarm defaults; every field here is also a composer task parameter (see AGENTS.md).
const agentSwarmAdvancedSchema = z.object({
  maxLanesPerParent: advancedInteger("maxLanesPerParent"),
  maxDepth: advancedInteger("maxDepth"),
  maxRunningLanes: advancedInteger("maxRunningLanes"),
  laneMaxSteps: advancedInteger("laneMaxSteps").nullable(),
  reconNudgeSteps: advancedInteger("reconNudgeSteps"),
  forkCompactionThresholdTokens: advancedInteger("forkCompactionThresholdTokens"),
  laneSummaryMaxTokens: advancedInteger("laneSummaryMaxTokens"),
  assemblyHintTokens: advancedInteger("assemblyHintTokens"),
  dormantLaneTurns: advancedInteger("dormantLaneTurns"),
  autoCheck: z.boolean(),
  budgetReservePercent: advancedInteger("budgetReservePercent"),
  laneWrapUpPercent: advancedInteger("laneWrapUpPercent")
}).strict().partial().transform((advanced) => normalizeAgentSwarmAdvancedSettings(advanced));

const agentPresetSchema = z.object({
  id: z.string().min(1).max(240),
  name: z.string().min(1).max(240),
  description: z.string().min(1).max(240),
  requiresSuperAdmin: z.boolean().default(false),
  hidden: z.boolean().optional(),
  payload: z.record(z.string(), z.unknown()),
  mode: z.enum(["standard", "agent_swarm", "quality_control_reviewer"]).optional(),
  leaderAgentId: z.string().min(1).max(240).optional(),
  routerId: z.string().min(1).max(240).nullable().optional(),
  spawnEffort: z.number().int().min(AGENT_SWARM_SPAWN_EFFORT_MIN).max(AGENT_SWARM_SPAWN_EFFORT_MAX).optional(),
  budgetsEnabled: z.boolean().optional(),
  tokenBudget: z.number().int().positive().max(AGENT_SWARM_MAX_TOKEN_BUDGET).optional(),
  timeBudgetMinutes: z.number().int().positive().max(AGENT_SWARM_MAX_TIME_BUDGET_MINUTES).optional(),
  advanced: agentSwarmAdvancedSchema.optional()
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
  model: z.string().min(1).max(240),
  payload: z.record(z.string(), z.unknown()).default({})
});
const modelRouterSchema = z.object({
  id: z.string().min(1).max(240),
  routingModel: z.string().min(1).max(240),
  defaultTargetModel: z.string().min(1).max(240),
  allowQuickMode: z.boolean().default(false),
  allowReasoningEffort: z.boolean().default(false),
  models: z.array(modelRouterTargetSchema).min(1).max(50)
});

const updateAdminSettingsSchema = z.object({
  allowUserSignup: z.boolean(),
  requireAdminSignupApproval: z.boolean(),
  enableForgotPassword: z.boolean(),
  requireEmailVerificationOnSignup: z.boolean(),
  enablePromptCaching: z.boolean(),
  idleCompactionForTasks: z.boolean().default(false),
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

  fastify.get("/api/admin/agent-swarm/outcomes", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return { outcomes: await loadAgentSwarmOutcomes() };
  });

  fastify.get("/api/admin/memory-refreshes", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return { refreshes: await listRecentMemoryRefreshes() };
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
