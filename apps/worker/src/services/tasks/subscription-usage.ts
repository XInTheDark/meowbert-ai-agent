import {
  computeUsageCostBreakdown,
  findPlatformModelRouterById,
  normalizePlatformModelMetadata,
  normalizePlatformModelRouters,
  normalizeUsageRateMultiplier,
  resolvePlatformModelRouterDefaultRuntimeModel,
  resolveUsageCostMultipliersForModel,
  toSafeInteger,
  type PlatformModelMetadata,
  type PlatformModelRouter,
  type UsageCostBreakdown,
  type UsageCostMultipliers
} from "@meowbert/shared";
import { query } from "../../lib/db.js";

interface MonthBounds {
  monthStartUtc: string;
  monthEndUtc: string;
}

interface UsageLimit {
  weightedTokens: number;
  durationDays: number;
}

interface UsageCostConfig {
  modelMetadata: PlatformModelMetadata;
  modelRouters: PlatformModelRouter[];
  rateMultiplier: number;
}

interface UsageCostCache {
  expiresAt: number;
  value: UsageCostConfig;
}

const USAGE_COST_CACHE_TTL_MS = 60_000;
let usageCostCache: UsageCostCache | null = null;

function currentUtcMonthBounds(referenceDate = new Date()): MonthBounds {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  return {
    monthStartUtc: monthStart.toISOString(),
    monthEndUtc: monthEnd.toISOString()
  };
}

function normalizeUsageLimits(value: unknown): UsageLimit[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byDuration = new Map<number, number>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as { weightedTokens?: unknown; durationDays?: unknown };
    const weightedTokens = toSafeInteger(candidate.weightedTokens as string | number | null | undefined);
    const durationDays = toSafeInteger(candidate.durationDays as string | number | null | undefined);
    if (weightedTokens <= 0 || durationDays <= 0) {
      continue;
    }

    byDuration.set(durationDays, (byDuration.get(durationDays) ?? 0) + weightedTokens);
  }

  return Array.from(byDuration.entries()).map(([durationDays, weightedTokens]) => ({ durationDays, weightedTokens }));
}

async function loadUsageCostConfig(): Promise<UsageCostConfig> {
  const nowMs = Date.now();
  if (usageCostCache && usageCostCache.expiresAt > nowMs) {
    return usageCostCache.value;
  }

  const result = await query<{
    usage_rate_multiplier: string | number;
    model_metadata_json: unknown;
    model_routers_json: unknown;
  }>(
    `SELECT usage_rate_multiplier,
            model_metadata_json,
            model_routers_json
       FROM platform_settings
      WHERE id = 1`
  );

  const row = result.rows[0];
  const value = {
    modelMetadata: normalizePlatformModelMetadata(row?.model_metadata_json ?? null),
    modelRouters: normalizePlatformModelRouters(row?.model_routers_json ?? null),
    rateMultiplier: normalizeUsageRateMultiplier(row?.usage_rate_multiplier ?? 1)
  };

  usageCostCache = {
    value,
    expiresAt: nowMs + USAGE_COST_CACHE_TTL_MS
  };

  return value;
}

export async function computeEstimatedCostUsageForModel(input: {
  model: string;
  inputTokens: number;
  cachedInputTokens?: number | null;
  cacheWriteInputTokens?: number | null;
  outputTokens: number;
  reasoningTokens?: number | null;
}): Promise<UsageCostBreakdown & {
  resolvedModel: string;
  multipliers: UsageCostMultipliers;
  }> {
  const config = await loadUsageCostConfig();
  const router = findPlatformModelRouterById(config.modelRouters, input.model);
  const resolvedModel = router ? resolvePlatformModelRouterDefaultRuntimeModel(router) : input.model;
  const multipliers = resolveUsageCostMultipliersForModel(resolvedModel, config.modelMetadata);
  const breakdown = computeUsageCostBreakdown({
    inputTokens: input.inputTokens,
    cachedInputTokens: input.cachedInputTokens,
    cacheWriteInputTokens: input.cacheWriteInputTokens,
    outputTokens: input.outputTokens,
    reasoningTokens: input.reasoningTokens,
    multipliers,
    rateMultiplier: config.rateMultiplier
  });

  return {
    ...breakdown,
    resolvedModel,
    multipliers
  };
}

export async function getUserMonthlySubscriptionQuotaStatus(userId: string): Promise<{
  used: number;
  limit: number;
  exceeded: boolean;
}> {
  const bounds = currentUtcMonthBounds();

  const [usageResult, limitResult, usageLimitsResult] = await Promise.all([
    query<{ total: string }>(
      `SELECT COALESCE(SUM(weighted_tokens), 0)::text AS total
         FROM user_token_usage_events
        WHERE user_id = $1
          AND provider_kind = 'platform'
          AND occurred_at >= $2::timestamptz
          AND occurred_at < $3::timestamptz`,
      [userId, bounds.monthStartUtc, bounds.monthEndUtc]
    ),
    query<{ total: string }>(
      `SELECT COALESCE(SUM(sp.monthly_token_quota), 0)::text AS total
         FROM subscription_plans sp
        WHERE sp.is_active = true
          AND (
            sp.is_default = true
            OR sp.id IN (SELECT usp.plan_id FROM user_subscription_plans usp WHERE usp.user_id = $1)
          )`,
      [userId]
    ),
    query<{ usage_limits_json: unknown; monthly_token_quota: string }>(
      `SELECT sp.usage_limits_json,
              sp.monthly_token_quota::text
         FROM subscription_plans sp
        WHERE sp.is_active = true
          AND (
            sp.is_default = true
            OR sp.id IN (SELECT usp.plan_id FROM user_subscription_plans usp WHERE usp.user_id = $1)
          )`,
      [userId]
    )
  ]);

  const used = toSafeInteger(usageResult.rows[0]?.total);
  const limit = toSafeInteger(limitResult.rows[0]?.total);
  const usageLimits = normalizeUsageLimits(usageLimitsResult.rows.flatMap((row) => {
    const limits = normalizeUsageLimits(row.usage_limits_json);
    if (limits.length > 0) {
      return limits;
    }

    const legacyQuota = toSafeInteger(row.monthly_token_quota);
    return legacyQuota > 0 ? [{ weightedTokens: legacyQuota, durationDays: 30 }] : [];
  }));
  const now = new Date();

  for (const usageLimit of usageLimits) {
    const windowStart = new Date(now.getTime() - usageLimit.durationDays * 24 * 60 * 60 * 1000);
    const rollingUsage = await query<{ total: string }>(
      `SELECT COALESCE(SUM(weighted_tokens), 0)::text AS total
         FROM user_token_usage_events
        WHERE user_id = $1
          AND provider_kind = 'platform'
          AND occurred_at >= $2::timestamptz
          AND occurred_at < $3::timestamptz`,
      [userId, windowStart.toISOString(), now.toISOString()]
    );

    if (toSafeInteger(rollingUsage.rows[0]?.total) >= usageLimit.weightedTokens) {
      return {
        used: toSafeInteger(rollingUsage.rows[0]?.total),
        limit: usageLimit.weightedTokens,
        exceeded: true
      };
    }
  }

  return {
    used,
    limit,
    exceeded: usageLimits.length === 0 && limit > 0 && used >= limit
  };
}

export async function recordPlatformTokenUsageEvent(input: {
  userId: string;
  taskId: string;
  runId: string;
  model: string;
  resolvedModel: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  multipliers: UsageCostMultipliers;
  rateMultiplier: number;
  weightedTokens: number;
}): Promise<void> {
  await query(
    `INSERT INTO user_token_usage_events (
      user_id,
      task_id,
      run_id,
      model,
      provider_kind,
      input_tokens,
      cached_input_tokens,
      output_tokens,
      reasoning_tokens,
      input_weight,
      output_weight,
      input_token_multiplier,
      cached_input_token_multiplier,
      output_token_multiplier,
      reasoning_token_multiplier,
      usage_rate_multiplier,
      weighted_tokens
    )
    VALUES ($1, $2, $3, $4, 'platform', $5, $6, $7, $8, $9, $10, $9, $11, $10, $12, $13, $14)`,
    [
      input.userId,
      input.taskId,
      input.runId,
      input.resolvedModel || input.model,
      Math.max(0, Math.floor(input.inputTokens)),
      Math.max(0, Math.floor(input.cachedInputTokens)),
      Math.max(0, Math.floor(input.outputTokens)),
      Math.max(0, Math.floor(input.reasoningTokens)),
      Math.max(0, input.multipliers.inputTokens),
      Math.max(0, input.multipliers.outputTokens),
      Math.max(0, input.multipliers.cachedInputTokens),
      Math.max(0, input.multipliers.reasoningTokens),
      Math.max(0, input.rateMultiplier),
      Math.max(0, Math.floor(input.weightedTokens))
    ]
  );
}
