import { nextUsageActivationAt, usageActivationInputSchema, type UsageActivationInput,
  type UsageActivationSchedule } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";

interface ScheduleRow {
  id: string; name: string; provider_id: string | null; model: string; enabled: boolean;
  rules_json: UsageActivationInput["rules"]; next_run_at: Date | null;
  last_run_at: Date | null; last_finished_at: Date | null;
  last_status: UsageActivationSchedule["lastStatus"]; last_error: string | null;
}

function mapSchedule(row: ScheduleRow): UsageActivationSchedule {
  return {
    id: row.id, name: row.name, providerId: row.provider_id, model: row.model,
    enabled: row.enabled, rules: row.rules_json, nextRunAt: row.next_run_at?.toISOString() ?? null,
    lastRunAt: row.last_run_at?.toISOString() ?? null, lastFinishedAt: row.last_finished_at?.toISOString() ?? null,
    lastStatus: row.last_status, lastError: row.last_error
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
  return withTransaction(async (client) => {
    // Bound the amount of scheduling work independently of the number of worker replicas.
    await client.query("SELECT pg_advisory_xact_lock($1)", [819205019]);
    const provider = await client.query("SELECT id FROM ai_providers WHERE id = $1 FOR KEY SHARE", [input.providerId]);
    if (!provider.rowCount) throw inputError("Choose an existing AI provider.");
    const clock = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const next = input.enabled ? nextUsageActivationAt(input.rules, clock.rows[0].now) : null;
    const params = [input.name, input.providerId, input.model, input.enabled, JSON.stringify(input.rules), next];
    if (id) {
      const result = await client.query<ScheduleRow>(
        `UPDATE usage_activation_schedules SET name = $1, provider_id = $2, model = $3,
           enabled = $4, rules_json = $5::jsonb, next_run_at = $6, revision = revision + 1,
           claim_token = NULL, claim_until = NULL, updated_at = clock_timestamp()
         WHERE id = $7 RETURNING *`, [...params, id]
      );
      if (!result.rowCount) throw inputError("Schedule not found.", 404);
      return mapSchedule(result.rows[0]);
    }
    const count = await client.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM usage_activation_schedules");
    if (count.rows[0].count >= 100) throw inputError("You can create up to 100 activation schedules.");
    const result = await client.query<ScheduleRow>(
      `INSERT INTO usage_activation_schedules (name, provider_id, model, enabled, rules_json, next_run_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`, params
    );
    return mapSchedule(result.rows[0]);
  });
}

export async function removeUsageActivationSchedule(id: string): Promise<void> {
  const result = await query("DELETE FROM usage_activation_schedules WHERE id = $1", [id]);
  if (!result.rowCount) throw inputError("Schedule not found.", 404);
}
