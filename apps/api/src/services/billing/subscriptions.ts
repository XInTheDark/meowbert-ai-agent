import type { PoolClient, QueryResultRow } from "pg";
import {
  toOptionalNumber,
  toSafeInteger
} from "@meowbert/shared";
import { assertSafePublicUrl } from "@meowbert/shared/server-security";
import { query, withTransaction } from "../../lib/db.js";
import { getAdminSettings, isSuperAdmin } from "../admin/admin-settings.js";
import {
  getUserChatGptAuth,
  updateUserChatGptForcedModel,
  type UserChatGptAuthStatus
} from "./chatgpt-oauth.js";

export interface SubscriptionPlan {
  id: string;
  name: string;
  monthlyTokenQuota: number;
  usageLimits: SubscriptionUsageLimit[];
  notes: string | null;
  isActive: boolean;
  isDefault: boolean;
  workspaceLimit: number | null;
  sandboxPidsLimit: number | null;
  sandboxMemoryMb: number | null;
  sandboxCpus: number | null;
  workspaceStorageMb: number | null;
  persistentRuntimeComputeCredits: number | null;
  persistentRuntimeLimit: number | null;
  agentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserAssignedSubscriptionPlan {
  id: string;
  name: string;
  monthlyTokenQuota: number;
  usageLimits: SubscriptionUsageLimit[];
  notes: string | null;
  isActive: boolean;
  workspaceLimit: number | null;
  sandboxPidsLimit: number | null;
  sandboxMemoryMb: number | null;
  sandboxCpus: number | null;
  workspaceStorageMb: number | null;
  persistentRuntimeComputeCredits: number | null;
  persistentRuntimeLimit: number | null;
  agentIds: string[];
  assignedAt: string;
}

export interface UserByoConfig {
  enabled: boolean;
  provider: "openai_compatible" | "chatgpt_oauth";
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
  apiKey?: string | null;
  chatgpt: UserChatGptAuthStatus;
}

export interface UserSubscriptionUsageSummary {
  monthStartUtc: string;
  monthEndUtc: string;
  weightedTokensUsed: number;
  weightedTokensLimit: number;
  weightedTokensRemaining: number;
}

export interface SubscriptionUsageLimit {
  weightedTokens: number;
  durationDays: number;
}

export interface SubscriptionUsageLimitStatus extends SubscriptionUsageLimit {
  used: number;
  remaining: number;
  percentUsed: number;
  percentRemaining: number;
  windowStartUtc: string;
  resetAtUtc: string;
  exceeded: boolean;
}

export interface UserSubscriptionUsageLimitsSummary {
  limits: SubscriptionUsageLimitStatus[];
}

interface MonthBounds {
  monthStartUtc: string;
  monthEndUtc: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAgentIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalizedId = entry.trim().toLowerCase();
    if (!normalizedId || seenIds.has(normalizedId)) {
      continue;
    }

    seenIds.add(normalizedId);
    normalizedIds.push(normalizedId);
  }

  return normalizedIds;
}

export function normalizeSubscriptionUsageLimits(value: unknown): SubscriptionUsageLimit[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const limitsByDuration = new Map<number, number>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as { weightedTokens?: unknown; durationDays?: unknown };
    const weightedTokens = toSafeInteger(
      typeof candidate.weightedTokens === "number" || typeof candidate.weightedTokens === "string"
        ? candidate.weightedTokens
        : 0
    );
    const durationDays = toSafeInteger(
      typeof candidate.durationDays === "number" || typeof candidate.durationDays === "string"
        ? candidate.durationDays
        : 0
    );

    if (weightedTokens <= 0 || durationDays <= 0) {
      continue;
    }

    limitsByDuration.set(durationDays, (limitsByDuration.get(durationDays) ?? 0) + weightedTokens);
  }

  return Array.from(limitsByDuration.entries())
    .map(([durationDays, weightedTokens]) => ({ weightedTokens, durationDays }))
    .sort((left, right) => left.durationDays - right.durationDays);
}

function deriveMonthlyTokenQuota(usageLimits: SubscriptionUsageLimit[], fallback = 0): number {
  const thirtyDayLimit = usageLimits.find((limit) => limit.durationDays === 30);
  if (thirtyDayLimit) {
    return thirtyDayLimit.weightedTokens;
  }

  return usageLimits.reduce((max, limit) => Math.max(max, limit.weightedTokens), Math.max(0, Math.floor(fallback)));
}

interface SubscriptionPlanRow extends QueryResultRow {
  id: string;
  name: string;
  monthly_token_quota: string;
  usage_limits_json: unknown;
  notes: string | null;
  is_active: boolean;
  is_default: boolean;
  workspace_limit: number | null;
  sandbox_pids_limit: number | null;
  sandbox_memory_mb: number | null;
  sandbox_cpus: string | number | null;
  workspace_storage_mb: number | null;
  persistent_runtime_compute_credits: number | null;
  persistent_runtime_limit: number | null;
  agent_ids_json: unknown;
  created_at: string;
  updated_at: string;
}

interface UserAssignedSubscriptionPlanRow extends QueryResultRow {
  id: string;
  name: string;
  monthly_token_quota: string;
  usage_limits_json: unknown;
  notes: string | null;
  is_active: boolean;
  workspace_limit: number | null;
  sandbox_pids_limit: number | null;
  sandbox_memory_mb: number | null;
  sandbox_cpus: string | number | null;
  workspace_storage_mb: number | null;
  persistent_runtime_compute_credits: number | null;
  persistent_runtime_limit: number | null;
  agent_ids_json: unknown;
  assigned_at: string;
}

function mapSubscriptionPlanRow(row: SubscriptionPlanRow): SubscriptionPlan {
  const usageLimits = normalizeSubscriptionUsageLimits(row.usage_limits_json);
  return {
    id: row.id,
    name: row.name,
    monthlyTokenQuota: toSafeInteger(row.monthly_token_quota),
    usageLimits,
    notes: row.notes,
    isActive: row.is_active,
    isDefault: row.is_default === true,
    workspaceLimit: row.workspace_limit,
    sandboxPidsLimit: row.sandbox_pids_limit,
    sandboxMemoryMb: row.sandbox_memory_mb,
    sandboxCpus: toOptionalNumber(row.sandbox_cpus),
    workspaceStorageMb: row.workspace_storage_mb,
    persistentRuntimeComputeCredits: row.persistent_runtime_compute_credits,
    persistentRuntimeLimit: row.persistent_runtime_limit,
    agentIds: normalizeAgentIds(row.agent_ids_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapUserAssignedSubscriptionPlanRow(row: UserAssignedSubscriptionPlanRow): UserAssignedSubscriptionPlan {
  const usageLimits = normalizeSubscriptionUsageLimits(row.usage_limits_json);
  return {
    id: row.id,
    name: row.name,
    monthlyTokenQuota: toSafeInteger(row.monthly_token_quota),
    usageLimits,
    notes: row.notes,
    isActive: row.is_active,
    workspaceLimit: row.workspace_limit,
    sandboxPidsLimit: row.sandbox_pids_limit,
    sandboxMemoryMb: row.sandbox_memory_mb,
    sandboxCpus: toOptionalNumber(row.sandbox_cpus),
    workspaceStorageMb: row.workspace_storage_mb,
    persistentRuntimeComputeCredits: row.persistent_runtime_compute_credits,
    persistentRuntimeLimit: row.persistent_runtime_limit,
    agentIds: normalizeAgentIds(row.agent_ids_json),
    assignedAt: row.assigned_at
  };
}

export function currentUtcMonthBounds(referenceDate = new Date()): MonthBounds {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  return {
    monthStartUtc: start.toISOString(),
    monthEndUtc: end.toISOString()
  };
}

export async function listSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const result = await query<SubscriptionPlanRow>(
    `SELECT id,
            name,
            monthly_token_quota::text,
            usage_limits_json,
            notes,
            is_active,
            is_default,
            workspace_limit,
            sandbox_pids_limit,
            sandbox_memory_mb,
            sandbox_cpus::text AS sandbox_cpus,
            workspace_storage_mb,
            persistent_runtime_compute_credits,
            persistent_runtime_limit,
            agent_ids_json,
            created_at,
            updated_at
       FROM subscription_plans
      ORDER BY is_default DESC, created_at ASC, name ASC`
  );

  return result.rows.map(mapSubscriptionPlanRow);
}

export async function createSubscriptionPlan(input: {
  name: string;
  monthlyTokenQuota?: number;
  usageLimits?: SubscriptionUsageLimit[] | null;
  notes?: string | null;
  workspaceLimit?: number | null;
  sandboxPidsLimit?: number | null;
  sandboxMemoryMb?: number | null;
  sandboxCpus?: number | null;
  workspaceStorageMb?: number | null;
  persistentRuntimeComputeCredits?: number | null;
  persistentRuntimeLimit?: number | null;
  agentIds?: string[] | null;
  isActive?: boolean;
}): Promise<SubscriptionPlan> {
  const trimmedName = input.name.trim();
  if (trimmedName.toLowerCase() === "[all users]") {
    throw new Error("Cannot create plan with reserved name [All Users]");
  }

  const agentIds = normalizeAgentIds(input.agentIds);
  const usageLimits = normalizeSubscriptionUsageLimits(
    input.usageLimits ?? (
      typeof input.monthlyTokenQuota === "number"
        ? [{ weightedTokens: input.monthlyTokenQuota, durationDays: 30 }]
        : []
    )
  );
  const monthlyTokenQuota = deriveMonthlyTokenQuota(usageLimits, input.monthlyTokenQuota);
  const result = await query<SubscriptionPlanRow>(
    `INSERT INTO subscription_plans (
       name,
       monthly_token_quota,
       usage_limits_json,
       notes,
       is_active,
       is_default,
       workspace_limit,
       sandbox_pids_limit,
       sandbox_memory_mb,
       sandbox_cpus,
       workspace_storage_mb,
       persistent_runtime_compute_credits,
       persistent_runtime_limit,
       agent_ids_json
     )
     VALUES ($1, $2, $3::jsonb, $4, $5, false, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
     RETURNING id,
               name,
               monthly_token_quota::text,
               usage_limits_json,
               notes,
               is_active,
               is_default,
               workspace_limit,
               sandbox_pids_limit,
               sandbox_memory_mb,
               sandbox_cpus::text AS sandbox_cpus,
               workspace_storage_mb,
               persistent_runtime_compute_credits,
               persistent_runtime_limit,
               agent_ids_json,
               created_at,
               updated_at`,
    [
      trimmedName,
      monthlyTokenQuota,
      JSON.stringify(usageLimits),
      normalizeOptionalText(input.notes),
      input.isActive ?? true,
      input.workspaceLimit ?? null,
      input.sandboxPidsLimit ?? null,
      input.sandboxMemoryMb ?? null,
      input.sandboxCpus ?? null,
      input.workspaceStorageMb ?? null,
      input.persistentRuntimeComputeCredits ?? null,
      input.persistentRuntimeLimit ?? null,
      JSON.stringify(agentIds)
    ]
  );

  return mapSubscriptionPlanRow(result.rows[0]);
}

export async function updateSubscriptionPlan(input: {
  planId: string;
  name?: string;
  monthlyTokenQuota?: number;
  usageLimits?: SubscriptionUsageLimit[] | null;
  notes?: string | null;
  workspaceLimit?: number | null;
  sandboxPidsLimit?: number | null;
  sandboxMemoryMb?: number | null;
  sandboxCpus?: number | null;
  workspaceStorageMb?: number | null;
  persistentRuntimeComputeCredits?: number | null;
  persistentRuntimeLimit?: number | null;
  agentIds?: string[] | null;
  isActive?: boolean;
}): Promise<SubscriptionPlan> {
  const existingRes = await query<{ is_default: boolean; name: string }>(
    `SELECT is_default, name FROM subscription_plans WHERE id = $1`,
    [input.planId]
  );
  if ((existingRes.rowCount ?? 0) === 0) {
    throw new Error("Subscription plan not found");
  }
  const isDefault = existingRes.rows[0].is_default === true;

  if (isDefault) {
    if (input.isActive === false) {
      throw new Error("The default [All Users] plan cannot be deactivated.");
    }
    if (typeof input.name === "string" && input.name.trim() !== existingRes.rows[0].name) {
      throw new Error("The default plan name cannot be changed.");
    }
  }

  const setClauses: string[] = [];
  const params: unknown[] = [input.planId];
  let paramIndex = 2;

  if (typeof input.name === "string" && !isDefault) {
    const trimmedName = input.name.trim();
    if (trimmedName.toLowerCase() === "[all users]") {
      throw new Error("Cannot rename plan to reserved name [All Users]");
    }
    setClauses.push(`name = $${paramIndex++}`);
    params.push(trimmedName);
  }

  if (typeof input.monthlyTokenQuota === "number" && input.usageLimits === undefined) {
    setClauses.push(`monthly_token_quota = $${paramIndex++}`);
    params.push(Math.max(0, Math.floor(input.monthlyTokenQuota)));
  }

  if (input.usageLimits !== undefined) {
    const usageLimits = normalizeSubscriptionUsageLimits(input.usageLimits);
    setClauses.push(`usage_limits_json = $${paramIndex++}::jsonb`);
    params.push(JSON.stringify(usageLimits));
    setClauses.push(`monthly_token_quota = $${paramIndex++}`);
    params.push(deriveMonthlyTokenQuota(usageLimits, input.monthlyTokenQuota));
  }

  if (input.notes !== undefined) {
    setClauses.push(`notes = $${paramIndex++}`);
    params.push(normalizeOptionalText(input.notes));
  }

  if (input.workspaceLimit !== undefined) {
    setClauses.push(`workspace_limit = $${paramIndex++}`);
    params.push(input.workspaceLimit);
  }

  if (input.sandboxPidsLimit !== undefined) {
    setClauses.push(`sandbox_pids_limit = $${paramIndex++}`);
    params.push(input.sandboxPidsLimit);
  }

  if (input.sandboxMemoryMb !== undefined) {
    setClauses.push(`sandbox_memory_mb = $${paramIndex++}`);
    params.push(input.sandboxMemoryMb);
  }

  if (input.sandboxCpus !== undefined) {
    setClauses.push(`sandbox_cpus = $${paramIndex++}`);
    params.push(input.sandboxCpus);
  }

  if (input.workspaceStorageMb !== undefined) {
    setClauses.push(`workspace_storage_mb = $${paramIndex++}`);
    params.push(input.workspaceStorageMb);
  }

  if (input.persistentRuntimeComputeCredits !== undefined) {
    setClauses.push(`persistent_runtime_compute_credits = $${paramIndex++}`);
    params.push(input.persistentRuntimeComputeCredits);
  }

  if (input.persistentRuntimeLimit !== undefined) {
    setClauses.push(`persistent_runtime_limit = $${paramIndex++}`);
    params.push(input.persistentRuntimeLimit);
  }

  if (input.agentIds !== undefined) {
    setClauses.push(`agent_ids_json = $${paramIndex++}::jsonb`);
    params.push(JSON.stringify(normalizeAgentIds(input.agentIds)));
  }

  if (typeof input.isActive === "boolean" && !isDefault) {
    setClauses.push(`is_active = $${paramIndex++}`);
    params.push(input.isActive);
  }

  if (setClauses.length === 0) {
    throw new Error("No updates provided");
  }

  const result = await query<SubscriptionPlanRow>(
    `UPDATE subscription_plans
        SET ${setClauses.join(", ")},
            updated_at = now()
      WHERE id = $1
      RETURNING id,
                name,
                monthly_token_quota::text,
                usage_limits_json,
                notes,
                is_active,
                is_default,
                workspace_limit,
                sandbox_pids_limit,
                sandbox_memory_mb,
                sandbox_cpus::text AS sandbox_cpus,
                workspace_storage_mb,
                persistent_runtime_compute_credits,
                persistent_runtime_limit,
                agent_ids_json,
                created_at,
                updated_at`,
    params
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("Subscription plan not found");
  }

  return mapSubscriptionPlanRow(result.rows[0]);
}

export async function replaceUserSubscriptionPlans(input: {
  userId: string;
  planIds: string[];
  assignedByUserId: string;
}): Promise<UserAssignedSubscriptionPlan[]> {
  const dedupedPlanIds = Array.from(new Set(input.planIds));

  await withTransaction(async (client) => {
    if (dedupedPlanIds.length > 0) {
      const planCheck = await client.query<{ id: string; is_default: boolean }>(
        `SELECT id, is_default
           FROM subscription_plans
          WHERE id = ANY($1::uuid[])`,
        [dedupedPlanIds]
      );

      const existing = new Set(planCheck.rows.map((row) => row.id));
      const missing = dedupedPlanIds.filter((id) => !existing.has(id));
      if (missing.length > 0) {
        throw new Error(`Unknown subscription plan ids: ${missing.join(", ")}`);
      }
      if (planCheck.rows.some((row) => row.is_default)) {
        throw new Error("The default [All Users] plan is applied to all users and cannot be assigned individually.");
      }
    }

    await client.query(`DELETE FROM user_subscription_plans WHERE user_id = $1`, [input.userId]);

    for (const planId of dedupedPlanIds) {
      await client.query(
        `INSERT INTO user_subscription_plans (user_id, plan_id, assigned_by_user_id)
         VALUES ($1, $2, $3)`,
        [input.userId, planId, input.assignedByUserId]
      );
    }
  });

  return listUserAssignedSubscriptionPlans(input.userId);
}

export async function listUserAssignedSubscriptionPlans(userId: string, client?: PoolClient): Promise<UserAssignedSubscriptionPlan[]> {
  const execute = async <T extends QueryResultRow>(sql: string, params: unknown[]): Promise<{ rows: T[] }> => {
    if (client) {
      const result = await client.query<T>(sql, params);
      return { rows: result.rows };
    }
    const result = await query<T>(sql, params);
    return { rows: result.rows };
  };

  const result = await execute<UserAssignedSubscriptionPlanRow>(
    `SELECT sp.id,
            sp.name,
            sp.monthly_token_quota::text,
            sp.usage_limits_json,
            sp.notes,
            sp.is_active,
            sp.workspace_limit,
            sp.sandbox_pids_limit,
            sp.sandbox_memory_mb,
            sp.sandbox_cpus::text AS sandbox_cpus,
            sp.workspace_storage_mb,
            sp.persistent_runtime_compute_credits,
            sp.persistent_runtime_limit,
            sp.agent_ids_json,
            usp.assigned_at
       FROM user_subscription_plans usp
       JOIN subscription_plans sp ON sp.id = usp.plan_id
      WHERE usp.user_id = $1
      ORDER BY sp.name ASC`,
    [userId]
  );

  return result.rows.map(mapUserAssignedSubscriptionPlanRow);
}

export async function listActiveSubscriptionPlanAgentIdsForUser(
  userId: string,
  client?: PoolClient
): Promise<string[]> {
  const execute = client
    ? <T extends QueryResultRow>(sql: string, params: unknown[]) => client.query<T>(sql, params)
    : <T extends QueryResultRow>(sql: string, params: unknown[]) => query<T>(sql, params);
  const result = await execute<{ agent_ids_json: unknown }>(
    `SELECT sp.agent_ids_json
       FROM subscription_plans sp
      WHERE sp.is_active = true
        AND (
          sp.is_default = true
          OR sp.id IN (SELECT usp.plan_id FROM user_subscription_plans usp WHERE usp.user_id = $1)
        )`,
    [userId]
  );

  return normalizeAgentIds(result.rows.flatMap((row) => normalizeAgentIds(row.agent_ids_json)));
}

export async function getUserMonthlyWeightedTokenUsage(
  userId: string,
  referenceDate = new Date(),
  client?: PoolClient
): Promise<UserSubscriptionUsageSummary> {
  const bounds = currentUtcMonthBounds(referenceDate);
  const runQueryFn = async <T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<{ rows: T[] }> => {
    if (client) {
      const result = await client.query<T>(sql, params);
      return { rows: result.rows };
    }
    const result = await query<T>(sql, params);
    return { rows: result.rows };
  };

  const [usageResult, limitResult] = await Promise.all([
    runQueryFn<{ total: string }>(
      `SELECT COALESCE(SUM(weighted_tokens), 0)::text AS total
         FROM user_token_usage_events
        WHERE user_id = $1
          AND provider_kind = 'platform'
          AND occurred_at >= $2::timestamptz
          AND occurred_at < $3::timestamptz`,
      [userId, bounds.monthStartUtc, bounds.monthEndUtc]
    ),
    runQueryFn<{ total: string }>(
      `SELECT COALESCE(SUM(sp.monthly_token_quota), 0)::text AS total
         FROM subscription_plans sp
        WHERE sp.is_active = true
          AND (
            sp.is_default = true
            OR sp.id IN (SELECT usp.plan_id FROM user_subscription_plans usp WHERE usp.user_id = $1)
          )`,
      [userId]
    )
  ]);

  const weightedTokensUsed = toSafeInteger(usageResult.rows[0]?.total);
  const weightedTokensLimit = toSafeInteger(limitResult.rows[0]?.total);

  return {
    monthStartUtc: bounds.monthStartUtc,
    monthEndUtc: bounds.monthEndUtc,
    weightedTokensUsed,
    weightedTokensLimit,
    weightedTokensRemaining: Math.max(0, weightedTokensLimit - weightedTokensUsed)
  };
}

async function loadActiveUsageLimitsForUser(
  userId: string,
  client?: PoolClient
): Promise<SubscriptionUsageLimit[]> {
  const execute = async <T extends QueryResultRow>(sql: string, params: unknown[]): Promise<{ rows: T[] }> => {
    if (client) {
      const result = await client.query<T>(sql, params);
      return { rows: result.rows };
    }
    const result = await query<T>(sql, params);
    return { rows: result.rows };
  };
  const result = await execute<{ usage_limits_json: unknown; monthly_token_quota: string }>(
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

  return normalizeSubscriptionUsageLimits(result.rows.flatMap((row) => {
    const limits = normalizeSubscriptionUsageLimits(row.usage_limits_json);
    if (limits.length > 0) {
      return limits;
    }

    const legacyQuota = toSafeInteger(row.monthly_token_quota);
    return legacyQuota > 0 ? [{ weightedTokens: legacyQuota, durationDays: 30 }] : [];
  }));
}

export async function getUserSubscriptionUsageLimits(
  userId: string,
  referenceDate = new Date(),
  client?: PoolClient
): Promise<UserSubscriptionUsageLimitsSummary> {
  const limits = await loadActiveUsageLimitsForUser(userId, client);
  if (limits.length === 0) {
    return { limits: [] };
  }

  const execute = async <T extends QueryResultRow>(sql: string, params: unknown[]): Promise<{ rows: T[] }> => {
    if (client) {
      const result = await client.query<T>(sql, params);
      return { rows: result.rows };
    }
    const result = await query<T>(sql, params);
    return { rows: result.rows };
  };
  const nowMs = referenceDate.getTime();
  const statuses = await Promise.all(limits.map(async (limit) => {
    const windowStart = new Date(nowMs - limit.durationDays * MS_PER_DAY);
    const usageResult = await execute<{ total: string; oldest_usage_at: string | null }>(
      `SELECT COALESCE(SUM(weighted_tokens), 0)::text AS total,
              MIN(occurred_at)::text AS oldest_usage_at
         FROM user_token_usage_events
        WHERE user_id = $1
          AND provider_kind = 'platform'
          AND occurred_at >= $2::timestamptz
          AND occurred_at < $3::timestamptz`,
      [userId, windowStart.toISOString(), referenceDate.toISOString()]
    );
    const used = toSafeInteger(usageResult.rows[0]?.total);
    const oldestUsageAt = usageResult.rows[0]?.oldest_usage_at;
    const resetBaseMs = oldestUsageAt ? new Date(oldestUsageAt).getTime() : nowMs;
    const resetAt = new Date(resetBaseMs + limit.durationDays * MS_PER_DAY);
    const ratioUsed = limit.weightedTokens > 0 ? Math.min(1, Math.max(0, used / limit.weightedTokens)) : 0;

    return {
      ...limit,
      used,
      remaining: Math.max(0, limit.weightedTokens - used),
      percentUsed: Math.round(ratioUsed * 100),
      percentRemaining: Math.max(0, 100 - Math.round(ratioUsed * 100)),
      windowStartUtc: windowStart.toISOString(),
      resetAtUtc: resetAt.toISOString(),
      exceeded: used >= limit.weightedTokens
    };
  }));

  return { limits: statuses };
}

export async function recordUserTokenUsageEvent(input: {
  userId: string;
  taskId: string;
  runId: string;
  model: string;
  providerKind: "platform" | "byo";
  inputTokens: number;
  outputTokens: number;
  inputWeight: number;
  outputWeight: number;
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
      output_tokens,
      input_weight,
      output_weight,
      weighted_tokens
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.userId,
      input.taskId,
      input.runId,
      input.model,
      input.providerKind,
      Math.max(0, Math.floor(input.inputTokens)),
      Math.max(0, Math.floor(input.outputTokens)),
      Math.max(0, input.inputWeight),
      Math.max(0, input.outputWeight),
      Math.max(0, Math.floor(input.weightedTokens))
    ]
  );
}

export async function getUserFreeMessageUsage(userId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM user_free_message_events
      WHERE user_id = $1`,
    [userId]
  );
  return toSafeInteger(result.rows[0]?.count);
}

// Returns null when the user has no message limit.
export async function resolveUserFreeMessageLimit(userId: string): Promise<number | null> {
  const [userResult, settings] = await Promise.all([
    query<{ message_rate_limit: number | null }>(
      `SELECT message_rate_limit
         FROM users
        WHERE id = $1`,
      [userId]
    ),
    getAdminSettings()
  ]);

  const override = userResult.rows[0]?.message_rate_limit;
  if (typeof override === "number") {
    return Math.max(0, Math.floor(override));
  }

  return settings.defaultFreeMessageLimit === null ? null : Math.max(0, Math.floor(settings.defaultFreeMessageLimit));
}

export async function recordUserFreeMessageEvent(input: {
  userId: string;
  taskId: string;
  taskMessageId: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO user_free_message_events (user_id, task_id, task_message_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (task_message_id) WHERE task_message_id IS NOT NULL DO NOTHING`,
    [input.userId, input.taskId, input.taskMessageId]
  );
}

export async function getUserByoConfig(userId: string, options: { includeApiKey?: boolean } = {}): Promise<UserByoConfig> {
  const [result, chatgpt] = await Promise.all([
    query<{
      byo_enabled: boolean;
      byo_provider: string | null;
      byo_base_url: string | null;
      byo_model: string | null;
      byo_api_key: string | null;
    }>(
      `SELECT byo_enabled, byo_provider, byo_base_url, byo_model, byo_api_key
         FROM users
        WHERE id = $1`,
      [userId]
    ),
    getUserChatGptAuth(userId)
  ]);

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("User not found");
  }

  const row = result.rows[0];
  const provider = row.byo_provider === "chatgpt_oauth" ? "chatgpt_oauth" : "openai_compatible";

  return {
    enabled: row.byo_enabled === true,
    provider,
    baseUrl: normalizeOptionalText(row.byo_base_url),
    model: provider === "chatgpt_oauth" ? chatgpt.forcedModel : normalizeOptionalText(row.byo_model),
    hasApiKey: normalizeOptionalText(row.byo_api_key) !== null,
    ...(options.includeApiKey ? { apiKey: normalizeOptionalText(row.byo_api_key) } : {}),
    chatgpt
  };
}

export async function updateUserByoConfig(input: {
  userId: string;
  enabled: boolean;
  provider?: "openai_compatible" | "chatgpt_oauth";
  baseUrl?: string | null;
  model?: string | null;
  apiKey?: string | null;
}): Promise<UserByoConfig> {
  const existing = await getUserByoConfig(input.userId, { includeApiKey: true });
  const nextProvider = input.provider ?? (existing.provider || "openai_compatible");

  if (nextProvider === "chatgpt_oauth") {
    if (input.enabled && !existing.chatgpt.isConnected) {
      throw new Error("Cannot enable ChatGPT BYO mode without an active ChatGPT connection.");
    }
    const nextModel = input.model === undefined ? existing.chatgpt.forcedModel : normalizeOptionalText(input.model);
    if (input.model !== undefined && existing.chatgpt.isConnected) {
      await updateUserChatGptForcedModel(input.userId, nextModel);
    }
    await query(
      `UPDATE users
          SET byo_enabled = $2,
              byo_provider = CASE WHEN $2 THEN 'chatgpt_oauth' ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [input.userId, input.enabled]
    );
    return getUserByoConfig(input.userId);
  }

  const nextBaseUrl = input.baseUrl === undefined ? existing.baseUrl : normalizeOptionalText(input.baseUrl);
  const nextModel = input.model === undefined ? existing.model : normalizeOptionalText(input.model);
  const nextApiKey = input.apiKey === undefined ? existing.apiKey ?? null : normalizeOptionalText(input.apiKey);

  if (input.enabled && (!nextBaseUrl || !nextModel || !nextApiKey)) {
    throw new Error("BYO provider requires base URL, model, and API key.");
  }

  if (nextBaseUrl) {
    await assertSafePublicUrl(nextBaseUrl, "BYO base URL");
  }

  await query(
    `UPDATE users
        SET byo_enabled = $2,
            byo_provider = CASE WHEN $2 THEN 'openai_compatible' ELSE NULL END,
            byo_base_url = CASE WHEN $2 THEN $3 ELSE NULL END,
            byo_model = CASE WHEN $2 THEN $4 ELSE NULL END,
            byo_api_key = CASE WHEN $2 THEN $5 ELSE NULL END,
            updated_at = now()
      WHERE id = $1`,
    [input.userId, input.enabled, nextBaseUrl, nextModel, nextApiKey]
  );

  return getUserByoConfig(input.userId);
}

export async function resolveUserAccessMode(userId: string): Promise<"admin_exempt" | "byo" | "subscription" | "free"> {
  if (await isSuperAdmin(userId)) {
    return "admin_exempt";
  }

  const [byo, usage, usageLimits] = await Promise.all([
    getUserByoConfig(userId),
    getUserMonthlyWeightedTokenUsage(userId),
    getUserSubscriptionUsageLimits(userId)
  ]);

  if (byo.enabled) {
    return "byo";
  }

  if (usageLimits.limits.length > 0 || usage.weightedTokensLimit > 0) {
    return "subscription";
  }

  return "free";
}
