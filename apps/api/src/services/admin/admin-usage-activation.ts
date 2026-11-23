import {
  nextUsageActivationAt,
  usageActivationInputSchema,
  type UsageActivationInput,
  type UsageActivationSchedule,
  type UsageActivationTargetType
} from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";

interface ScheduleRow {
  id: string;
  name: string;
  target_type: UsageActivationTargetType;
  provider_id: string | null;
  antigravity_credential_ids: string[] | null;
  model: string;
  enabled: boolean;
  rules_json: UsageActivationInput["rules"];
  next_run_at: Date | null;
  last_run_at: Date | null;
  last_finished_at: Date | null;
  last_status: UsageActivationSchedule["lastStatus"];
  last_error: string | null;
}

function mapSchedule(row: ScheduleRow): UsageActivationSchedule {
  return {
    id: row.id,
    name: row.name,
    targetType: row.target_type ?? "ai_provider",
    providerId: row.provider_id,
    antigravityCredentialIds: Array.isArray(row.antigravity_credential_ids) ? row.antigravity_credential_ids : [],
    model: row.model,
    enabled: row.enabled,
    rules: row.rules_json,
    nextRunAt: row.next_run_at?.toISOString() ?? null,
    lastRunAt: row.last_run_at?.toISOString() ?? null,
    lastFinishedAt: row.last_finished_at?.toISOString() ?? null,
    lastStatus: row.last_status,
    lastError: row.last_error
  };
}

function inputError(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode, exposeMessage: true });
}

export async function listUsageActivationSchedules(): Promise<UsageActivationSchedule[]> {
  const result = await query<ScheduleRow>("SELECT * FROM usage_activation_schedules ORDER BY created_at, id");
  return result.rows.map(mapSchedule);
}

export async function saveUsageActivationSchedule(raw: UsageActivationInput, id?: string): Promise<UsageActivationSchedule> {
  const input = usageActivationInputSchema.parse(raw);
  const uniqueCredentialIds = input.targetType === "antigravity"
    ? [...new Set(input.antigravityCredentialIds)]
    : [];
  const providerId = input.targetType === "ai_provider" ? (input.providerId ?? null) : null;

  return withTransaction(async (client) => {
    // Bound the amount of scheduling work independently of the number of worker replicas.
    await client.query("SELECT pg_advisory_xact_lock($1)", [819205019]);
    if (input.targetType === "antigravity") {
      const creds = await client.query<{ id: string }>(
        "SELECT id FROM antigravity_credentials WHERE id = ANY($1::uuid[]) FOR KEY SHARE",
        [uniqueCredentialIds]
      );
      if (creds.rowCount !== uniqueCredentialIds.length) {
        throw inputError("Choose existing Antigravity accounts.");
      }
    } else {
      const provider = await client.query("SELECT id FROM ai_providers WHERE id = $1 FOR KEY SHARE", [providerId]);
      if (!provider.rowCount) throw inputError("Choose an existing AI provider.");
    }

    const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const next = input.enabled ? nextUsageActivationAt(input.rules, clock.rows[0].now) : null;
    const params = [
      input.name,
      input.targetType,
      providerId,
      uniqueCredentialIds,
      input.model,
      input.enabled,
      JSON.stringify(input.rules),
      next
    ];
    if (id) {
      const result = await client.query<ScheduleRow>(
        `UPDATE usage_activation_schedules
            SET name = $1, target_type = $2, provider_id = $3, antigravity_credential_ids = $4::uuid[],
                model = $5, enabled = $6, rules_json = $7::jsonb, next_run_at = $8,
                revision = revision + 1, claim_token = NULL, claim_until = NULL, updated_at = clock_timestamp()
          WHERE id = $9 RETURNING *`,
        [...params, id]
      );
      if (!result.rowCount) throw inputError("Schedule not found.", 404);
      return mapSchedule(result.rows[0]);
    }
    const count = await client.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM usage_activation_schedules");
    if (count.rows[0].count >= 100) throw inputError("You can create up to 100 activation schedules.");
    const result = await client.query<ScheduleRow>(
      `INSERT INTO usage_activation_schedules
         (name, target_type, provider_id, antigravity_credential_ids, model, enabled, rules_json, next_run_at)
       VALUES ($1, $2, $3, $4::uuid[], $5, $6, $7::jsonb, $8) RETURNING *`,
      params
    );
    return mapSchedule(result.rows[0]);
  });
}

export async function removeUsageActivationSchedule(id: string): Promise<void> {
  const result = await query("DELETE FROM usage_activation_schedules WHERE id = $1", [id]);
  if (!result.rowCount) throw inputError("Schedule not found.", 404);
}
