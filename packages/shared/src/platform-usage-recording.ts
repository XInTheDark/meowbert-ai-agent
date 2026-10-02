import { normalizePlatformModelMetadata, type PlatformModelMetadata } from "./model-metadata.js";
import {
  findPlatformModelRouterById,
  normalizePlatformModelRouters,
  resolvePlatformModelRouterDefaultRuntimeModel,
  type PlatformModelRouter
} from "./model-routers.js";
import { parseModelResponseUsage, type ModelUsageCounts } from "./model-usage-counts.js";
import {
  computeUsageCostBreakdown,
  normalizeUsageRateMultiplier,
  resolveUsageCostMultipliersForModel,
  type UsageCostBreakdown
} from "./usage-cost.js";

type UsageQuery = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

// Who pays for a platform model call. Null billing means the call is not metered (BYO providers).
export interface PlatformUsageBilling {
  userId: string;
  taskId: string | null;
  runId: string | null;
}

export type PlatformUsageCost = UsageCostBreakdown & { resolvedModel: string };

interface UsageCostConfig {
  modelMetadata: PlatformModelMetadata;
  modelRouters: PlatformModelRouter[];
  rateMultiplier: number;
}

interface UsageCostConfigRow {
  usage_rate_multiplier: string | number | null;
  model_metadata_json: unknown;
  model_routers_json: unknown;
}

const USAGE_COST_CACHE_TTL_MS = 60_000;

export interface PlatformUsageRecorder {
  computeCost: (model: string, counts: ModelUsageCounts) => Promise<PlatformUsageCost>;
  recordEvent: (billing: PlatformUsageBilling, counts: ModelUsageCounts, cost: PlatformUsageCost) => Promise<void>;
  // Meters one model response. Never throws: a billing failure must not break the call it measures.
  recordResponseUsage: (billing: PlatformUsageBilling | null, model: string, usage: unknown) => Promise<void>;
}

export function createPlatformUsageRecorder(query: UsageQuery): PlatformUsageRecorder {
  let cache: { expiresAt: number; value: UsageCostConfig } | null = null;

  async function loadCostConfig(): Promise<UsageCostConfig> {
    const nowMs = Date.now();
    if (cache && cache.expiresAt > nowMs) {
      return cache.value;
    }
    const result = await query(
      `SELECT usage_rate_multiplier, model_metadata_json, model_routers_json
         FROM platform_settings
        WHERE id = 1`
    );
    const row = result.rows[0] as UsageCostConfigRow | undefined;
    const value = {
      modelMetadata: normalizePlatformModelMetadata(row?.model_metadata_json ?? null),
      modelRouters: normalizePlatformModelRouters(row?.model_routers_json ?? null),
      rateMultiplier: normalizeUsageRateMultiplier(row?.usage_rate_multiplier ?? 1)
    };
    cache = { value, expiresAt: nowMs + USAGE_COST_CACHE_TTL_MS };
    return value;
  }

  async function computeCost(model: string, counts: ModelUsageCounts): Promise<PlatformUsageCost> {
    const config = await loadCostConfig();
    const router = findPlatformModelRouterById(config.modelRouters, model);
    const resolvedModel = router ? resolvePlatformModelRouterDefaultRuntimeModel(router) : model;
    const breakdown = computeUsageCostBreakdown({
      ...counts,
      multipliers: resolveUsageCostMultipliersForModel(resolvedModel, config.modelMetadata),
      rateMultiplier: config.rateMultiplier
    });
    return { ...breakdown, resolvedModel };
  }

  async function recordEvent(billing: PlatformUsageBilling, counts: ModelUsageCounts, cost: PlatformUsageCost) {
    await query(
      `INSERT INTO user_token_usage_events (
        user_id, task_id, run_id, model, provider_kind,
        input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
        input_weight, output_weight,
        input_token_multiplier, cached_input_token_multiplier, output_token_multiplier,
        reasoning_token_multiplier, usage_rate_multiplier, weighted_tokens
      )
      VALUES ($1, $2, $3, $4, 'platform', $5, $6, $7, $8, $9, $10, $9, $11, $10, $12, $13, $14)`,
      [
        billing.userId,
        billing.taskId,
        billing.runId,
        cost.resolvedModel,
        counts.inputTokens,
        cost.cachedInputTokens,
        counts.outputTokens,
        cost.reasoningTokens,
        cost.multipliers.inputTokens,
        cost.multipliers.outputTokens,
        cost.multipliers.cachedInputTokens,
        cost.multipliers.reasoningTokens,
        cost.rateMultiplier,
        cost.weightedTokens
      ]
    );
  }

  async function recordResponseUsage(billing: PlatformUsageBilling | null, model: string, usage: unknown) {
    const counts = parseModelResponseUsage(usage);
    if (!billing || !counts) {
      return;
    }
    try {
      await recordEvent(billing, counts, await computeCost(model, counts));
    } catch (error) {
      console.error("[platform-usage] Failed to record model usage", {
        taskId: billing.taskId,
        model,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { computeCost, recordEvent, recordResponseUsage };
}
