import { randomUUID } from "node:crypto";
import { nextUsageActivationAt, usageActivationInputSchema, type UsageActivationStatus } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";

export interface ActivationClaim {
  id: string; token: string; revision: number; model: string;
}

export async function claimDueActivations(): Promise<ActivationClaim[]> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      id: string; rules_json: unknown; next_run_at: Date; now: Date; revision: number; model: string;
    }>(`SELECT id, rules_json, next_run_at, clock_timestamp() AS now, revision, model
        FROM usage_activation_schedules
        WHERE enabled = true AND next_run_at <= now()
          AND (claim_until IS NULL OR claim_until <= now())
        ORDER BY next_run_at, id LIMIT 10 FOR UPDATE SKIP LOCKED`);
    const claims: ActivationClaim[] = [];
    for (const row of result.rows) {
      const parsed = usageActivationInputSchema.shape.rules.safeParse(row.rules_json);
      if (!parsed.success) {
        await client.query(`UPDATE usage_activation_schedules SET enabled = false, next_run_at = NULL,
          claim_token = NULL, claim_until = NULL, last_status = 'failed',
          last_error = 'Invalid schedule rules. Edit and save this schedule.' WHERE id = $1`, [row.id]);
        continue;
      }
      const stale = row.now.getTime() - row.next_run_at.getTime() >= 60_000;
      const token = stale ? null : randomUUID();
      await client.query(`UPDATE usage_activation_schedules SET next_run_at = $2,
        last_run_at = $3, last_finished_at = $4, last_status = $5, last_error = $6,
        claim_token = $7, claim_until = $8 WHERE id = $1`, [
        row.id, nextUsageActivationAt(parsed.data, row.now), row.next_run_at, stale ? row.now : null,
        stale ? "skipped" : "running", stale ? "Missed occurrence; waiting for the next scheduled time." : null,
        token, stale ? null : new Date(row.now.getTime() + 120_000)
      ]);
      if (token) claims.push({ id: row.id, token, revision: row.revision, model: row.model });
    }
    return claims;
  });
}

export async function getActivationProvider(claim: ActivationClaim): Promise<{ baseUrl: string; apiKey: string } | null> {
  const result = await query<{ base_url: string | null; api_key: string | null }>(
    `SELECT p.base_url, p.api_key FROM usage_activation_schedules s
     LEFT JOIN ai_providers p ON p.id = s.provider_id
     WHERE s.id = $1 AND s.claim_token = $2 AND s.revision = $3 AND s.enabled = true
       AND s.claim_until > clock_timestamp()`,
    [claim.id, claim.token, claim.revision]
  );
  const row = result.rows[0];
  if (!row) return null;
  if (!row.base_url || !row.api_key) throw new Error("provider_missing");
  return { baseUrl: row.base_url, apiKey: row.api_key };
}

export async function finishActivation(claim: ActivationClaim, status: UsageActivationStatus, error: string | null): Promise<void> {
  await query(`UPDATE usage_activation_schedules SET last_status = $3, last_error = $4,
    last_finished_at = clock_timestamp(), claim_token = NULL, claim_until = NULL
    WHERE id = $1 AND claim_token = $2 AND revision = $5`, [claim.id, claim.token, status, error, claim.revision]);
}

export async function expireActivationClaims(): Promise<void> {
  await query(`UPDATE usage_activation_schedules SET last_status = 'interrupted',
    last_error = 'Worker stopped before recording a result; this occurrence will not be retried.',
    last_finished_at = clock_timestamp(), claim_token = NULL, claim_until = NULL
    WHERE claim_until <= now()`);
}
