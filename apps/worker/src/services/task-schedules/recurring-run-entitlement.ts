import type { PoolClient } from "pg";
import { toSafeInteger } from "@meowbert/shared";

export type UserAccessMode = "admin_exempt" | "byo" | "subscription" | "free";

export interface PromptEntitlementStatus {
  mode: UserAccessMode;
  allowed: boolean;
  reason: string | null;
  freeMessageLimit: number | null;
  freeMessagesUsed: number;
  monthlyWeightedTokenLimit: number;
  monthlyWeightedTokenUsed: number;
  subscriptionUsageLimitExceeded: boolean;
}

interface RecurringRunAccountabilityRow {
  created_by_user_id: string | null;
  initiator_user_id: string | null;
}

interface UserEntitlementRow {
  is_super_admin: boolean;
  byo_enabled: boolean;
  message_rate_limit: number | null;
}

interface UsageLimit {
  weightedTokens: number;
  durationDays: number;
}

function currentUtcMonthBounds(referenceDate = new Date()): { monthStartUtc: string; monthEndUtc: string } {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  return {
    monthStartUtc: start.toISOString(),
    monthEndUtc: end.toISOString()
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

async function pauseRecurringScheduleInTx(client: PoolClient, taskId: string): Promise<void> {
  await client.query(
    `UPDATE task_schedules
        SET schedule_state = 'paused',
            next_run_at = NULL,
            pending_run = false,
            run_deadline_at = NULL,
            updated_at = now()
      WHERE task_id = $1`,
    [taskId]
  );
}

async function getPromptEntitlementStatusInTx(client: PoolClient, userId: string): Promise<PromptEntitlementStatus> {
  const userRes = await client.query<UserEntitlementRow>(
    `SELECT is_super_admin, byo_enabled, message_rate_limit
       FROM users
      WHERE id = $1`,
    [userId]
  );

  if ((userRes.rowCount ?? 0) === 0) {
    throw new Error("User not found");
  }

  const user = userRes.rows[0];
  if (user.is_super_admin === true) {
    return {
      mode: "admin_exempt",
      allowed: true,
      reason: null,
      freeMessageLimit: 0,
      freeMessagesUsed: 0,
      monthlyWeightedTokenLimit: 0,
      monthlyWeightedTokenUsed: 0,
      subscriptionUsageLimitExceeded: false
    };
  }

  const bounds = currentUtcMonthBounds();
  const freeUsageRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM user_free_message_events
      WHERE user_id = $1`,
    [userId]
  );
  const monthlyUsageRes = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(weighted_tokens), 0)::text AS total
       FROM user_token_usage_events
      WHERE user_id = $1
        AND provider_kind = 'platform'
        AND occurred_at >= $2::timestamptz
        AND occurred_at < $3::timestamptz`,
    [userId, bounds.monthStartUtc, bounds.monthEndUtc]
  );
  const monthlyLimitRes = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(sp.monthly_token_quota), 0)::text AS total
       FROM subscription_plans sp
      WHERE sp.is_active = true
        AND (
          sp.is_default = true
          OR sp.id IN (SELECT usp.plan_id FROM user_subscription_plans usp WHERE usp.user_id = $1)
        )`,
    [userId]
  );
  const usageLimitsRes = await client.query<{ usage_limits_json: unknown; monthly_token_quota: string }>(
    `SELECT sp.usage_limits_json,
            sp.monthly_token_quota::text
       FROM subscription_plans sp
      WHERE sp.is_active = true
        AND (
          sp.is_default = true
          OR sp.id IN (SELECT usp.plan_id FROM user_subscription_plans usp WHERE usp.user_id = $1)
        )`,
    [userId]
  );
  const settingsRes = await client.query<{ default_free_message_limit: number | null }>(
    `SELECT default_free_message_limit
       FROM platform_settings
      LIMIT 1`
  );

  const freeLimitOverride = user.message_rate_limit;
  const defaultFreeMessageLimit = settingsRes.rows[0]?.default_free_message_limit ?? null;
  const freeMessageLimit = typeof freeLimitOverride === "number"
    ? Math.max(0, Math.floor(freeLimitOverride))
    : defaultFreeMessageLimit === null ? null : Math.max(0, Math.floor(defaultFreeMessageLimit));
  const freeMessagesUsed = toSafeInteger(freeUsageRes.rows[0]?.count);
  const monthlyWeightedTokenUsed = toSafeInteger(monthlyUsageRes.rows[0]?.total);
  const monthlyWeightedTokenLimit = toSafeInteger(monthlyLimitRes.rows[0]?.total);
  const usageLimits = normalizeUsageLimits(usageLimitsRes.rows.flatMap((row) => {
    const limits = normalizeUsageLimits(row.usage_limits_json);
    if (limits.length > 0) {
      return limits;
    }
    const legacyQuota = toSafeInteger(row.monthly_token_quota);
    return legacyQuota > 0 ? [{ weightedTokens: legacyQuota, durationDays: 30 }] : [];
  }));
  const now = new Date();
  let subscriptionUsageLimitExceeded = false;
  for (const limit of usageLimits) {
    const windowStart = new Date(now.getTime() - limit.durationDays * 24 * 60 * 60 * 1000);
    const usageRes = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(weighted_tokens), 0)::text AS total
         FROM user_token_usage_events
        WHERE user_id = $1
          AND provider_kind = 'platform'
          AND occurred_at >= $2::timestamptz
          AND occurred_at < $3::timestamptz`,
      [userId, windowStart.toISOString(), now.toISOString()]
    );
    if (toSafeInteger(usageRes.rows[0]?.total) >= limit.weightedTokens) {
      subscriptionUsageLimitExceeded = true;
      break;
    }
  }

  if (user.byo_enabled === true) {
    return {
      mode: "byo",
      allowed: true,
      reason: null,
      freeMessageLimit,
      freeMessagesUsed,
      monthlyWeightedTokenLimit,
      monthlyWeightedTokenUsed,
      subscriptionUsageLimitExceeded
    };
  }

  if (usageLimits.length > 0 || monthlyWeightedTokenLimit > 0) {
    const allowed = usageLimits.length > 0
      ? !subscriptionUsageLimitExceeded
      : monthlyWeightedTokenUsed < monthlyWeightedTokenLimit;
    return {
      mode: "subscription",
      allowed,
      reason: allowed ? null : "Subscription usage limit reached.",
      freeMessageLimit,
      freeMessagesUsed,
      monthlyWeightedTokenLimit,
      monthlyWeightedTokenUsed,
      subscriptionUsageLimitExceeded: !allowed
    };
  }

  const allowed = freeMessageLimit === null || freeMessagesUsed < freeMessageLimit;
  return {
    mode: "free",
    allowed,
    reason: allowed ? null : "Lifetime free message quota exceeded.",
    freeMessageLimit,
    freeMessagesUsed,
    monthlyWeightedTokenLimit,
    monthlyWeightedTokenUsed,
    subscriptionUsageLimitExceeded
  };
}

export async function resolveRecurringRunPromptEntitlementInTx(
  client: PoolClient,
  taskId: string
): Promise<{ accountableUserId: string; entitlement: PromptEntitlementStatus } | null> {
  const accountabilityRes = await client.query<RecurringRunAccountabilityRow>(
    `SELECT ts.created_by_user_id,
            t.initiator_user_id
       FROM task_schedules ts
       JOIN tasks t ON t.id = ts.task_id
      WHERE ts.task_id = $1
      FOR UPDATE`,
    [taskId]
  );

  if ((accountabilityRes.rowCount ?? 0) === 0) {
    return null;
  }

  const accountableUserId =
    accountabilityRes.rows[0].created_by_user_id
    ?? accountabilityRes.rows[0].initiator_user_id;
  if (!accountableUserId) {
    await pauseRecurringScheduleInTx(client, taskId);
    return null;
  }

  const entitlement = await getPromptEntitlementStatusInTx(client, accountableUserId);
  if (!entitlement.allowed) {
    await pauseRecurringScheduleInTx(client, taskId);
    return null;
  }

  return {
    accountableUserId,
    entitlement
  };
}

export async function recordRecurringRunPromptUsageInTx(input: {
  client: PoolClient;
  taskId: string;
  accountableUserId: string;
  entitlement: PromptEntitlementStatus;
}): Promise<void> {
  if (input.entitlement.mode !== "free") {
    return;
  }

  await input.client.query(
    `INSERT INTO user_free_message_events (user_id, task_id, task_message_id)
     VALUES ($1, $2, NULL)`,
    [input.accountableUserId, input.taskId]
  );
}
