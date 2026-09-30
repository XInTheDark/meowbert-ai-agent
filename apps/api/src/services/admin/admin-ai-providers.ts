import { aiProviderInputSchema, type AdminAiProvider, type AiProviderConfig } from "@meowbert/shared";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../lib/db.js";

const AI_PROVIDERS_LOCK = 819205018;

class AiProviderNotFoundError extends Error {
  readonly statusCode = 404;
  readonly exposeMessage = true;

  constructor() {
    super("AI provider not found.");
  }
}

export async function listAdminAiProviders(client?: PoolClient): Promise<AdminAiProvider[]> {
  const sql = `SELECT id, base_url, is_selected FROM ai_providers ORDER BY created_at, id`;
  const result = client ? await client.query(sql) : await query(sql);
  return result.rows.map((row) => ({
    id: row.id,
    baseUrl: row.base_url,
    selected: row.is_selected
  }));
}

export async function addAdminAiProvider(input: AiProviderConfig): Promise<AdminAiProvider[]> {
  const provider = aiProviderInputSchema.parse(input);
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [AI_PROVIDERS_LOCK]);
    await client.query(
      `INSERT INTO ai_providers (base_url, api_key, is_selected)
       VALUES ($1, $2, NOT EXISTS (SELECT 1 FROM ai_providers))`,
      [provider.baseUrl, provider.apiKey]
    );
    return listAdminAiProviders(client);
  });
}

export async function selectAdminAiProvider(id: string): Promise<AdminAiProvider[]> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [AI_PROVIDERS_LOCK]);
    const existing = await client.query("SELECT id FROM ai_providers WHERE id = $1", [id]);
    if (!existing.rowCount) throw new AiProviderNotFoundError();
    await client.query("UPDATE ai_providers SET is_selected = false WHERE is_selected = true");
    await client.query("UPDATE ai_providers SET is_selected = true WHERE id = $1", [id]);
    return listAdminAiProviders(client);
  });
}

export async function removeAdminAiProvider(id: string): Promise<AdminAiProvider[]> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [AI_PROVIDERS_LOCK]);
    await client.query(
      `UPDATE usage_activation_schedules SET enabled = false, next_run_at = NULL, revision = revision + 1,
         claim_token = NULL, claim_until = NULL
       WHERE provider_id = $1`, [id]
    );
    const deleted = await client.query("DELETE FROM ai_providers WHERE id = $1", [id]);
    if (!deleted.rowCount) throw new AiProviderNotFoundError();
    return listAdminAiProviders(client);
  });
}
