import {
  DEFAULT_WORKSPACE_LIMIT,
  resolveEffectiveUserResourceLimits,
  toOptionalNumber,
  toSafeInteger,
  toSignedInteger,
  type EffectiveUserResourceLimits
} from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { hashPassword } from "../../lib/auth.js";
import { config } from "../../lib/config.js";
import { currentUtcMonthBounds } from "../billing/subscriptions.js";
import {
  buildUsageAdjustmentEvents,
  dedupeUsageWindows,
  type UsageAdjustmentWindow
} from "./admin-usage-adjustments.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface UserSubscriptionSummary {
  id: string;
  name: string;
  monthlyTokenQuota: number;
  usageLimits: Array<{ weightedTokens: number; durationDays: number }>;
  isActive: boolean;
}

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  resourceLimits: EffectiveUserResourceLimits;
  isSuperAdmin: boolean;
  isActive: boolean;
  signupApprovalStatus: "approved" | "pending" | "rejected";
  freeMessageLimit: number | null;
  freeMessagesUsed: number;
  monthlyWeightedTokensUsed: number;
  monthlyWeightedTokensLimit: number;
  subscriptions: UserSubscriptionSummary[];
}

export interface GetUsersOptions {
  page: number;
  limit: number;
  search?: string;
}

export interface GetUsersResult {
  users: User[];
  total: number;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  created_at: Date;
  last_login_at: Date | null;
  last_seen_at: Date | null;
  workspace_limit: number | null;
  sandbox_pids_limit: number | null;
  sandbox_memory_mb: number | null;
  sandbox_cpus: string | number | null;
  workspace_storage_mb: number | null;
  persistent_runtime_compute_credits: number | null;
  persistent_runtime_limit: number | null;
  plan_workspace_limit: number | null;
  plan_sandbox_pids_limit: number | null;
  plan_sandbox_memory_mb: number | null;
  plan_sandbox_cpus: string | number | null;
  plan_workspace_storage_mb: number | null;
  plan_persistent_runtime_compute_credits: number | null;
  plan_persistent_runtime_limit: number | null;
  is_super_admin: boolean;
  is_active: boolean;
  signup_approval_status: "approved" | "pending" | "rejected";
  message_rate_limit: number | null;
}

function normalizeUsageLimits(value: unknown): Array<{ weightedTokens: number; durationDays: number }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as { weightedTokens?: unknown; durationDays?: unknown };
      const weightedTokens = toSafeInteger(candidate.weightedTokens as string | number | null | undefined);
      const durationDays = toSafeInteger(candidate.durationDays as string | number | null | undefined);
      return weightedTokens > 0 && durationDays > 0 ? { weightedTokens, durationDays } : null;
    })
    .filter((entry): entry is { weightedTokens: number; durationDays: number } => entry !== null);
}

function mapUserResourceLimits(row: UserRow): EffectiveUserResourceLimits {
  return resolveEffectiveUserResourceLimits({
    defaults: config.runtime.sandbox.resources,
    defaultWorkspaceLimit: DEFAULT_WORKSPACE_LIMIT,
    subscriptionPlanOverrides: {
      workspaceLimit: row.plan_workspace_limit,
      sandboxPidsLimit: row.plan_sandbox_pids_limit,
      sandboxMemoryMb: row.plan_sandbox_memory_mb,
      sandboxCpus: toOptionalNumber(row.plan_sandbox_cpus),
      workspaceStorageMb: row.plan_workspace_storage_mb,
      persistentRuntimeComputeCredits: row.plan_persistent_runtime_compute_credits,
      persistentRuntimeLimit: row.plan_persistent_runtime_limit
    },
    overrides: {
      workspaceLimit: row.workspace_limit,
      sandboxPidsLimit: row.sandbox_pids_limit,
      sandboxMemoryMb: row.sandbox_memory_mb,
      sandboxCpus: toOptionalNumber(row.sandbox_cpus),
      workspaceStorageMb: row.workspace_storage_mb,
      persistentRuntimeComputeCredits: row.persistent_runtime_compute_credits,
      persistentRuntimeLimit: row.persistent_runtime_limit
    }
  });
}

function mapUser(row: UserRow, extras?: {
  freeMessagesUsed?: number;
  monthlyWeightedTokensUsed?: number;
  monthlyWeightedTokensLimit?: number;
  subscriptions?: UserSubscriptionSummary[];
}): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
    lastLoginAt: row.last_login_at?.toISOString() ?? null,
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    resourceLimits: mapUserResourceLimits(row),
    isSuperAdmin: row.is_super_admin,
    isActive: row.is_active,
    signupApprovalStatus: row.signup_approval_status,
    freeMessageLimit: row.message_rate_limit,
    freeMessagesUsed: extras?.freeMessagesUsed ?? 0,
    monthlyWeightedTokensUsed: extras?.monthlyWeightedTokensUsed ?? 0,
    monthlyWeightedTokensLimit: extras?.monthlyWeightedTokensLimit ?? 0,
    subscriptions: extras?.subscriptions ?? []
  };
}

export async function getUsers(options: GetUsersOptions): Promise<GetUsersResult> {
  const offset = (options.page - 1) * options.limit;
  const params: unknown[] = [options.limit, offset];
  let whereClause = "";
  let countWhereClause = "";
  let countParams: unknown[] = [];

  if (options.search) {
    whereClause = "WHERE email ILIKE $3 OR display_name ILIKE $3";
    countWhereClause = "WHERE email ILIKE $1 OR display_name ILIKE $1";
    params.push(`%${options.search}%`);
    countParams = [`%${options.search}%`];
  }

  const usersResult = await query<UserRow>(
    `SELECT u.id,
            u.email,
            u.display_name,
            u.created_at,
            u.last_login_at,
            u.last_seen_at,
            u.workspace_limit,
            u.sandbox_pids_limit,
            u.sandbox_memory_mb,
            u.sandbox_cpus::text AS sandbox_cpus,
            u.workspace_storage_mb,
            u.persistent_runtime_compute_credits,
            u.persistent_runtime_limit,
            plan_limits.workspace_limit AS plan_workspace_limit,
            plan_limits.sandbox_pids_limit AS plan_sandbox_pids_limit,
            plan_limits.sandbox_memory_mb AS plan_sandbox_memory_mb,
            plan_limits.sandbox_cpus::text AS plan_sandbox_cpus,
            plan_limits.workspace_storage_mb AS plan_workspace_storage_mb,
            plan_limits.persistent_runtime_compute_credits AS plan_persistent_runtime_compute_credits,
            plan_limits.persistent_runtime_limit AS plan_persistent_runtime_limit,
            u.is_super_admin,
            u.is_active,
            u.signup_approval_status,
            u.message_rate_limit
       FROM users u
       LEFT JOIN LATERAL (
         SELECT MAX(sp.workspace_limit)::int AS workspace_limit,
                MAX(sp.sandbox_pids_limit)::int AS sandbox_pids_limit,
                MAX(sp.sandbox_memory_mb)::int AS sandbox_memory_mb,
                MAX(sp.sandbox_cpus)::numeric(10, 3) AS sandbox_cpus,
                MAX(sp.workspace_storage_mb)::int AS workspace_storage_mb,
                MAX(sp.persistent_runtime_compute_credits)::int AS persistent_runtime_compute_credits,
                MAX(sp.persistent_runtime_limit)::int AS persistent_runtime_limit
           FROM subscription_plans sp
          WHERE sp.is_active = true
            AND (
              sp.is_default = true
              OR sp.id IN (SELECT usp.plan_id FROM user_subscription_plans usp WHERE usp.user_id = u.id)
            )
       ) AS plan_limits ON true
       ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2`,
    params
  );

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM users ${countWhereClause}`,
    countParams
  );

  const userIds = usersResult.rows.map((row) => row.id);
  const freeUsageMap = new Map<string, number>();
  const tokenUsageMap = new Map<string, number>();
  const tokenLimitMap = new Map<string, number>();
  const subscriptionsMap = new Map<string, UserSubscriptionSummary[]>();

  if (userIds.length > 0) {
    const bounds = currentUtcMonthBounds();

    const [freeUsageRows, tokenUsageRows, tokenLimitRows, subscriptionsRows] = await Promise.all([
      query<{ user_id: string; count: string }>(
        `SELECT user_id, COUNT(*)::text AS count
           FROM user_free_message_events
          WHERE user_id = ANY($1::uuid[])
          GROUP BY user_id`,
        [userIds]
      ),
      query<{ user_id: string; total: string }>(
        `SELECT user_id, COALESCE(SUM(weighted_tokens), 0)::text AS total
           FROM user_token_usage_events
          WHERE user_id = ANY($1::uuid[])
            AND provider_kind = 'platform'
            AND occurred_at >= $2::timestamptz
            AND occurred_at < $3::timestamptz
          GROUP BY user_id`,
        [userIds, bounds.monthStartUtc, bounds.monthEndUtc]
      ),
      query<{ user_id: string; total: string }>(
        `SELECT u.id AS user_id, COALESCE(SUM(sp.monthly_token_quota), 0)::text AS total
           FROM users u
           JOIN subscription_plans sp ON sp.is_active = true
            AND (
              sp.is_default = true
              OR sp.id IN (SELECT usp.plan_id FROM user_subscription_plans usp WHERE usp.user_id = u.id)
            )
          WHERE u.id = ANY($1::uuid[])
          GROUP BY u.id`,
        [userIds]
      ),
      query<{
        user_id: string;
        id: string;
        name: string;
        monthly_token_quota: string;
        usage_limits_json: unknown;
        is_active: boolean;
      }>(
        `SELECT usp.user_id,
                sp.id,
                sp.name,
                sp.monthly_token_quota::text,
                sp.usage_limits_json,
                sp.is_active
           FROM user_subscription_plans usp
           JOIN subscription_plans sp ON sp.id = usp.plan_id
          WHERE usp.user_id = ANY($1::uuid[])
          ORDER BY sp.name ASC`,
        [userIds]
      )
    ]);

    for (const row of freeUsageRows.rows) {
      freeUsageMap.set(row.user_id, toSafeInteger(row.count));
    }

    for (const row of tokenUsageRows.rows) {
      tokenUsageMap.set(row.user_id, toSafeInteger(row.total));
    }

    for (const row of tokenLimitRows.rows) {
      tokenLimitMap.set(row.user_id, toSafeInteger(row.total));
    }

    for (const row of subscriptionsRows.rows) {
      const current = subscriptionsMap.get(row.user_id) ?? [];
      current.push({
        id: row.id,
        name: row.name,
        monthlyTokenQuota: toSafeInteger(row.monthly_token_quota),
        usageLimits: normalizeUsageLimits(row.usage_limits_json),
        isActive: row.is_active
      });
      subscriptionsMap.set(row.user_id, current);
    }
  }

  return {
    users: usersResult.rows.map((row) => ({
      ...mapUser(row, {
        freeMessagesUsed: freeUsageMap.get(row.id) ?? 0,
        monthlyWeightedTokensUsed: tokenUsageMap.get(row.id) ?? 0,
        monthlyWeightedTokensLimit: tokenLimitMap.get(row.id) ?? 0,
        subscriptions: subscriptionsMap.get(row.id) ?? []
      })
    })),
    total: Number.parseInt(countResult.rows[0].count, 10)
  };
}

export async function setUserTokenUsage(input: {
  userId: string;
  targetUsage: number;
  adjustedByUserId: string;
}): Promise<{ used: number; previousUsed: number; delta: number }> {
  const targetUsage = Math.max(0, Math.floor(input.targetUsage));
  const referenceDate = new Date();
  const bounds = currentUtcMonthBounds(referenceDate);

  return withTransaction(async (client) => {
    const userResult = await client.query<{ id: string }>(
      `SELECT id
         FROM users
        WHERE id = $1
        FOR UPDATE`,
      [input.userId]
    );

    if ((userResult.rowCount ?? 0) === 0) {
      throw new Error("User not found");
    }

    const activeLimitsResult = await client.query<{ usage_limits_json: unknown; monthly_token_quota: string }>(
      `SELECT sp.usage_limits_json,
              sp.monthly_token_quota::text
         FROM subscription_plans sp
        WHERE sp.is_active = true
          AND (
            sp.is_default = true
            OR sp.id IN (SELECT usp.plan_id FROM user_subscription_plans usp WHERE usp.user_id = $1)
          )`,
      [input.userId]
    );

    const usageWindows: Array<{ startUtc: string; endUtc: string }> = [{
      startUtc: bounds.monthStartUtc,
      endUtc: referenceDate.toISOString()
    }];
    for (const row of activeLimitsResult.rows) {
      const limits = normalizeUsageLimits(row.usage_limits_json);
      const planLimits = limits.length > 0
        ? limits
        : (() => {
            const legacyQuota = toSafeInteger(row.monthly_token_quota);
            return legacyQuota > 0 ? [{ weightedTokens: legacyQuota, durationDays: 30 }] : [];
          })();
      for (const limit of planLimits) {
        usageWindows.push({
          startUtc: new Date(referenceDate.getTime() - limit.durationDays * MS_PER_DAY).toISOString(),
          endUtc: referenceDate.toISOString()
        });
      }
    }

    const windowsWithUsage = await Promise.all(dedupeUsageWindows(usageWindows.map((window) => ({
      ...window,
      currentUsage: 0
    }))).map(async (window) => {
      const usageResult = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(weighted_tokens), 0)::text AS total
           FROM user_token_usage_events
          WHERE user_id = $1
            AND provider_kind = 'platform'
            AND occurred_at >= $2::timestamptz
            AND occurred_at < $3::timestamptz`,
        [input.userId, window.startUtc, window.endUtc]
      );
      return {
        ...window,
        currentUsage: toSignedInteger(usageResult.rows[0]?.total)
      };
    }));

    const monthlyWindow = windowsWithUsage.find((window) => (
      window.startUtc === bounds.monthStartUtc && window.endUtc === referenceDate.toISOString()
    ));
    const previousRawUsage = monthlyWindow?.currentUsage ?? 0;
    const adjustmentEvents = buildUsageAdjustmentEvents({
      windows: windowsWithUsage,
      targetUsage,
      referenceDate
    });

    for (const event of adjustmentEvents) {
      await client.query(
        `INSERT INTO user_token_usage_events (
          user_id,
          model,
          provider_kind,
          input_tokens,
          output_tokens,
          input_weight,
          output_weight,
          weighted_tokens,
          occurred_at,
          usage_event_kind,
          adjusted_by_user_id,
          adjustment_reason
        )
        VALUES ($1, '__admin_usage_adjustment__', 'platform', 0, 0, 0, 0, $2, $3::timestamptz, 'admin_adjustment', $4, $5)`,
        [
          input.userId,
          event.delta,
          event.occurredAtUtc,
          input.adjustedByUserId,
          `Set current usage from ${Math.max(0, previousRawUsage)} to ${targetUsage}`
        ]
      );
    }

    return {
      used: targetUsage,
      previousUsed: Math.max(0, previousRawUsage),
      delta: adjustmentEvents.reduce((sum, event) => sum + event.delta, 0)
    };
  });
}

export interface UpdateUserOptions {
  workspaceLimit?: number | null;
  sandboxPidsLimit?: number | null;
  sandboxMemoryMb?: number | null;
  sandboxCpus?: number | null;
  workspaceStorageMb?: number | null;
  persistentRuntimeComputeCredits?: number | null;
  persistentRuntimeLimit?: number | null;
  isSuperAdmin?: boolean;
  isActive?: boolean;
  freeMessageLimit?: number | null;
}

export async function updateUser(userId: string, updates: UpdateUserOptions): Promise<User> {
  const setClauses: string[] = [];
  const params: unknown[] = [userId];
  let paramIndex = 2;

  if (updates.workspaceLimit !== undefined) {
    setClauses.push(`workspace_limit = $${paramIndex++}`);
    params.push(updates.workspaceLimit);
  }

  if (updates.sandboxPidsLimit !== undefined) {
    setClauses.push(`sandbox_pids_limit = $${paramIndex++}`);
    params.push(updates.sandboxPidsLimit);
  }

  if (updates.sandboxMemoryMb !== undefined) {
    setClauses.push(`sandbox_memory_mb = $${paramIndex++}`);
    params.push(updates.sandboxMemoryMb);
  }

  if (updates.sandboxCpus !== undefined) {
    setClauses.push(`sandbox_cpus = $${paramIndex++}`);
    params.push(updates.sandboxCpus);
  }

  if (updates.workspaceStorageMb !== undefined) {
    setClauses.push(`workspace_storage_mb = $${paramIndex++}`);
    params.push(updates.workspaceStorageMb);
  }

  if (updates.persistentRuntimeComputeCredits !== undefined) {
    setClauses.push(`persistent_runtime_compute_credits = $${paramIndex++}`);
    params.push(updates.persistentRuntimeComputeCredits);
  }

  if (updates.persistentRuntimeLimit !== undefined) {
    setClauses.push(`persistent_runtime_limit = $${paramIndex++}`);
    params.push(updates.persistentRuntimeLimit);
  }

  if (updates.isSuperAdmin !== undefined) {
    setClauses.push(`is_super_admin = $${paramIndex++}`);
    params.push(updates.isSuperAdmin);
  }

  if (updates.isActive !== undefined) {
    setClauses.push(`is_active = $${paramIndex++}`);
    params.push(updates.isActive);
    if (updates.isActive === false) {
      setClauses.push("session_valid_after = date_trunc('second', now())");
    }
  }

  if (updates.freeMessageLimit !== undefined) {
    setClauses.push(`message_rate_limit = $${paramIndex++}`);
    params.push(updates.freeMessageLimit);
  }

  if (setClauses.length === 0) {
    throw new Error("No updates provided");
  }

  const result = await query<UserRow>(
    `UPDATE users
       SET ${setClauses.join(", ")}, updated_at = now()
     WHERE id = $1
    RETURNING id,
              email,
              display_name,
              created_at,
              last_login_at,
              last_seen_at,
              workspace_limit,
              sandbox_pids_limit,
              sandbox_memory_mb,
              sandbox_cpus::text AS sandbox_cpus,
              workspace_storage_mb,
              persistent_runtime_compute_credits,
              persistent_runtime_limit,
              NULL::integer AS plan_workspace_limit,
              NULL::integer AS plan_sandbox_pids_limit,
              NULL::integer AS plan_sandbox_memory_mb,
              NULL::text AS plan_sandbox_cpus,
              NULL::integer AS plan_workspace_storage_mb,
              NULL::integer AS plan_persistent_runtime_compute_credits,
              NULL::integer AS plan_persistent_runtime_limit,
              is_super_admin,
              is_active,
              signup_approval_status,
              message_rate_limit`,
    params
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("User not found");
  }

  return mapUser(result.rows[0]);
}

export async function updateUserSignupApproval(input: {
  userId: string;
  decision: "approve" | "reject";
  actorUserId: string;
}): Promise<User> {
  const decisionSql =
    input.decision === "approve"
      ? `signup_approval_status = 'approved',
         is_active = CASE WHEN email_verified_at IS NOT NULL THEN true ELSE false END,
         approved_at = now(),
         approved_by_user_id = $2,
         rejected_at = NULL,
         rejected_by_user_id = NULL`
      : `signup_approval_status = 'rejected',
         is_active = false,
         session_valid_after = date_trunc('second', now()),
         rejected_at = now(),
         rejected_by_user_id = $2`;

  const result = await query<UserRow>(
    `UPDATE users
        SET ${decisionSql},
            updated_at = now()
      WHERE id = $1
      RETURNING id,
                email,
                display_name,
                created_at,
                last_login_at,
                last_seen_at,
                workspace_limit,
                sandbox_pids_limit,
                sandbox_memory_mb,
                sandbox_cpus::text AS sandbox_cpus,
                workspace_storage_mb,
                persistent_runtime_compute_credits,
                persistent_runtime_limit,
                NULL::integer AS plan_workspace_limit,
                NULL::integer AS plan_sandbox_pids_limit,
                NULL::integer AS plan_sandbox_memory_mb,
                NULL::text AS plan_sandbox_cpus,
                NULL::integer AS plan_workspace_storage_mb,
                NULL::integer AS plan_persistent_runtime_compute_credits,
                NULL::integer AS plan_persistent_runtime_limit,
                is_super_admin,
                is_active,
                signup_approval_status,
                message_rate_limit`,
    [input.userId, input.actorUserId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("User not found");
  }

  return mapUser(result.rows[0]);
}

export async function changeUserPassword(userId: string, newPassword: string): Promise<void> {
  const hash = await hashPassword(newPassword);
  const result = await query(
    `UPDATE users
        SET password_hash = $2,
            session_valid_after = date_trunc('second', now()),
            updated_at = now()
      WHERE id = $1`,
    [userId, hash]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new Error("User not found");
  }
}

export async function deleteUser(userId: string): Promise<void> {
  await withTransaction(async (client) => {
    // Nullify FK references that don't have ON DELETE CASCADE/SET NULL
    await client.query(`UPDATE tasks SET initiator_user_id = NULL WHERE initiator_user_id = $1`, [userId]);
    await client.query(`UPDATE environments SET created_by = NULL WHERE created_by = $1`, [userId]);
    await client.query(`UPDATE task_message_revisions SET edited_by_user_id = NULL WHERE edited_by_user_id = $1`, [userId]);
    await client.query(`UPDATE audit_logs SET actor_user_id = NULL WHERE actor_user_id = $1`, [userId]);
    // Delete user (cascades handle workspace_members, connector_pairings, connector_pair_codes)
    const result = await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    if ((result.rowCount ?? 0) === 0) {
      throw new Error("User not found");
    }
  });
}
