import {
  toSafeInteger,
  type ModelUsageCounts,
  type PlatformUsageBilling,
  type PlatformUsageCost
} from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { platformUsageRecorder } from "./platform-usage.js";

interface MonthBounds {
  monthStartUtc: string;
  monthEndUtc: string;
}

interface UsageLimit {
  weightedTokens: number;
  durationDays: number;
}

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

export async function computeEstimatedCostUsageForModel(
  input: ModelUsageCounts & { model: string }
): Promise<PlatformUsageCost> {
  const { model, ...counts } = input;
  return platformUsageRecorder.computeCost(model, counts);
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

export async function recordPlatformTokenUsageEvent(
  billing: PlatformUsageBilling,
  counts: ModelUsageCounts,
  cost: PlatformUsageCost
): Promise<void> {
  await platformUsageRecorder.recordEvent(billing, counts, cost);
}
