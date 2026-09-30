import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { resolveEffectivePersistentRuntimeComputeCredits, resolveEffectivePersistentRuntimeLimit } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
const CREDIT_INTERVAL_MS = 60_000;
type PersistentShellSessionStatus = "starting" | "running" | "idle" | "completed" | "stopped" | "failed";
function isActiveStatus(status: PersistentShellSessionStatus): boolean {
  return status === "starting" || status === "running" || status === "idle";
}
interface PersistentRuntimeEntitlementRow {
  is_super_admin: boolean;
  persistent_runtime_compute_credits: number | null;
  persistent_runtime_limit: number | null;
  plan_persistent_runtime_compute_credits: number | null;
  plan_persistent_runtime_limit: number | null;
}

function dbQuery<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient | null,
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return client ? client.query<T>(text, params) : query<T>(text, params);
}

function currentUtcMonthBounds(reference = new Date()): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1)),
    end: new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1))
  };
}

async function resolveEntitlement(userId: string, client?: PoolClient): Promise<{
  isSuperAdmin: boolean;
  credits: number;
  limit: number;
}> {
  const result = await dbQuery<PersistentRuntimeEntitlementRow>(client ?? null,
    `SELECT u.is_super_admin,
            u.persistent_runtime_compute_credits,
            u.persistent_runtime_limit,
            plan_limits.persistent_runtime_compute_credits AS plan_persistent_runtime_compute_credits,
            plan_limits.persistent_runtime_limit AS plan_persistent_runtime_limit
       FROM users u
       LEFT JOIN LATERAL (
         SELECT MAX(sp.persistent_runtime_compute_credits)::int AS persistent_runtime_compute_credits,
                MAX(sp.persistent_runtime_limit)::int AS persistent_runtime_limit
           FROM subscription_plans sp
          WHERE sp.is_active = true
            AND (sp.is_default = true OR sp.id IN (
              SELECT usp.plan_id FROM user_subscription_plans usp WHERE usp.user_id = u.id
            ))
       ) plan_limits ON true
      WHERE u.id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Persistent runtime creator no longer exists.");
  }
  if (row.is_super_admin) {
    return { isSuperAdmin: true, credits: Number.POSITIVE_INFINITY, limit: Number.POSITIVE_INFINITY };
  }
  return {
    isSuperAdmin: false,
    credits: resolveEffectivePersistentRuntimeComputeCredits({
      subscriptionPlanCredits: row.plan_persistent_runtime_compute_credits,
      userCredits: row.persistent_runtime_compute_credits
    }),
    limit: resolveEffectivePersistentRuntimeLimit({
      subscriptionPlanLimit: row.plan_persistent_runtime_limit,
      userLimit: row.persistent_runtime_limit
    })
  };
}

export interface CreditReservation {
  eventId: string | null;
  credits: number;
}

async function withClientTransaction<T>(client: PoolClient, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function reserveCreditAndSlot(input: {
  userId: string;
  sessionId: string;
  newSession: boolean;
  chargeElapsed?: boolean;
}, dbClient: PoolClient | null = null): Promise<CreditReservation> {
  const reserve = async (client: PoolClient): Promise<CreditReservation> => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.userId]);
    const sessionResult = await client.query<{ last_charged_at: Date | null; status: PersistentShellSessionStatus }>(
      `SELECT last_charged_at, status
         FROM persistent_shell_sessions
        WHERE id = $1
        FOR UPDATE`,
      [input.sessionId]
    );
    const session = sessionResult.rows[0];
    if (!session) {
      throw new Error("Persistent shell session no longer exists.");
    }
    if (input.chargeElapsed && !isActiveStatus(session.status)) {
      return { eventId: null, credits: 0 };
    }
    const now = new Date();
    const creditsToCharge = input.chargeElapsed
      ? session.last_charged_at
        ? Math.floor(Math.max(0, now.getTime() - session.last_charged_at.getTime()) / CREDIT_INTERVAL_MS)
        : 0
      : 1;
    if (creditsToCharge < 1) {
      return { eventId: null, credits: 0 };
    }
    const entitlement = await resolveEntitlement(input.userId, client);
    if (!entitlement.isSuperAdmin) {
      if (entitlement.credits < creditsToCharge) {
        throw new Error("Persistent runtime compute credits are unavailable for this user.");
      }
      if (input.newSession) {
        const active = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM persistent_shell_sessions
            WHERE creator_user_id = $1 AND status IN ('starting', 'running', 'idle')`,
          [input.userId]
        );
        if (Number.parseInt(active.rows[0]?.count ?? "0", 10) > entitlement.limit) {
          throw new Error(`Persistent runtime limit reached (${entitlement.limit}). Stop a session or use another project.`);
        }
      }
      const bounds = currentUtcMonthBounds();
      const usage = await client.query<{ credits: string }>(
        `SELECT COALESCE(SUM(credits), 0)::text AS credits
           FROM user_persistent_runtime_compute_events
          WHERE user_id = $1 AND occurred_at >= $2 AND occurred_at < $3`,
        [input.userId, bounds.start, bounds.end]
      );
      const usedCredits = Number.parseInt(usage.rows[0]?.credits ?? "0", 10);
      if (usedCredits + creditsToCharge > entitlement.credits) {
        throw new Error("Persistent runtime compute credits are exhausted for this calendar month.");
      }
      const event = await client.query<{ id: string }>(
        `INSERT INTO user_persistent_runtime_compute_events (user_id, session_id, credits)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [input.userId, input.sessionId, creditsToCharge]
      );
      const chargedThrough = input.chargeElapsed && session.last_charged_at
        ? new Date(session.last_charged_at.getTime() + creditsToCharge * CREDIT_INTERVAL_MS)
        : now;
      await client.query(
        `UPDATE persistent_shell_sessions SET last_charged_at = $2, updated_at = now() WHERE id = $1`,
        [input.sessionId, chargedThrough]
      );
      return { eventId: event.rows[0]?.id ?? null, credits: creditsToCharge };
    }
    await client.query(
      `UPDATE persistent_shell_sessions SET last_charged_at = $2, updated_at = now() WHERE id = $1`,
      [input.sessionId, now]
    );
    return { eventId: null, credits: creditsToCharge };
  };
  return dbClient ? withClientTransaction(dbClient, reserve) : withTransaction(reserve);
}
