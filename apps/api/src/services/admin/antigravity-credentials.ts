import type { AdminAntigravityCredential } from "@meowbert/shared";
import {
  decryptAntigravitySecret,
  encryptAntigravitySecret,
  parseAntigravityTokenExpiry
} from "@meowbert/shared/antigravity-crypto";
import type { PoolClient } from "pg";
import { secrets } from "../../lib/config.js";
import { query, withTransaction } from "../../lib/db.js";

const ANTIGRAVITY_CREDENTIALS_LOCK = 819205019;

export class AntigravityCredentialNotFoundError extends Error {
  readonly statusCode = 404;
  readonly exposeMessage = true;

  constructor() {
    super("Antigravity credential not found.");
  }
}

interface CredentialRow {
  id: string;
  label: string;
  email: string | null;
  tier_name: string | null;
  tier_id: string | null;
  is_selected: boolean;
  last_error: string | null;
  last_used_at: Date | string | null;
  created_at: Date | string;
}

function toAdminCredential(row: CredentialRow): AdminAntigravityCredential {
  return {
    id: row.id,
    label: row.label,
    email: row.email,
    tierName: row.tier_name,
    tierId: row.tier_id,
    selected: row.is_selected,
    lastError: row.last_error,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString()
  };
}

export async function listAdminAntigravityCredentials(client?: PoolClient): Promise<AdminAntigravityCredential[]> {
  const sql = `SELECT id, label, email, tier_name, tier_id, is_selected, last_error, last_used_at, created_at
                 FROM antigravity_credentials
                ORDER BY created_at, id`;
  const result = client ? await client.query<CredentialRow>(sql) : await query<CredentialRow>(sql);
  return result.rows.map(toAdminCredential);
}

export async function saveAdminAntigravityCredential(input: {
  label: string;
  email: string | null;
  oauthTokenJson: string;
  acpAuthStateJson: string;
}): Promise<AdminAntigravityCredential[]> {
  const oauthEncrypted = encryptAntigravitySecret(input.oauthTokenJson, secrets.jwtSecret);
  const authStateEncrypted = encryptAntigravitySecret(input.acpAuthStateJson, secrets.jwtSecret);
  const tokenExpiry = parseAntigravityTokenExpiry(input.oauthTokenJson);
  const label = input.label.trim() || input.email?.trim() || "Google Account";

  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [ANTIGRAVITY_CREDENTIALS_LOCK]);
    await client.query(
      `INSERT INTO antigravity_credentials (
         label, email, oauth_token_encrypted, acp_auth_state_encrypted, token_expiry, is_selected
       )
       VALUES ($1, $2, $3, $4, $5, NOT EXISTS (SELECT 1 FROM antigravity_credentials))`,
      [label, input.email, oauthEncrypted, authStateEncrypted, tokenExpiry]
    );
    return listAdminAntigravityCredentials(client);
  });
}

export async function selectAdminAntigravityCredential(id: string): Promise<AdminAntigravityCredential[]> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [ANTIGRAVITY_CREDENTIALS_LOCK]);
    const existing = await client.query("SELECT id FROM antigravity_credentials WHERE id = $1", [id]);
    if (!existing.rowCount) throw new AntigravityCredentialNotFoundError();
    await client.query("UPDATE antigravity_credentials SET is_selected = false WHERE is_selected = true");
    await client.query("UPDATE antigravity_credentials SET is_selected = true, updated_at = now() WHERE id = $1", [id]);
    return listAdminAntigravityCredentials(client);
  });
}

export async function removeAdminAntigravityCredential(id: string): Promise<AdminAntigravityCredential[]> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [ANTIGRAVITY_CREDENTIALS_LOCK]);
    await client.query(
      `UPDATE usage_activation_schedules
          SET antigravity_credential_ids = array_remove(antigravity_credential_ids, $1::uuid),
              enabled = CASE WHEN cardinality(array_remove(antigravity_credential_ids, $1::uuid)) = 0 THEN false ELSE enabled END,
              next_run_at = CASE WHEN cardinality(array_remove(antigravity_credential_ids, $1::uuid)) = 0 THEN NULL ELSE next_run_at END,
              revision = revision + 1,
              claim_token = NULL,
              claim_until = NULL
        WHERE target_type = 'antigravity' AND $1::uuid = ANY(antigravity_credential_ids)`,
      [id]
    );
    const deleted = await client.query<{ is_selected: boolean }>(
      "DELETE FROM antigravity_credentials WHERE id = $1 RETURNING is_selected",
      [id]
    );
    if (!deleted.rowCount) throw new AntigravityCredentialNotFoundError();
    if (deleted.rows[0]?.is_selected) {
      await client.query(
        `UPDATE antigravity_credentials
            SET is_selected = true, updated_at = now()
          WHERE id = (SELECT id FROM antigravity_credentials ORDER BY created_at, id LIMIT 1)`
      );
    }
    return listAdminAntigravityCredentials(client);
  });
}

export async function loadDecryptedAntigravityCredential(id: string): Promise<{
  id: string;
  oauthTokenJson: string;
  acpAuthStateJson: string;
}> {
  const result = await query<{
    id: string;
    oauth_token_encrypted: string;
    acp_auth_state_encrypted: string;
  }>(
    `SELECT id, oauth_token_encrypted, acp_auth_state_encrypted
       FROM antigravity_credentials
      WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) throw new AntigravityCredentialNotFoundError();
  return {
    id: row.id,
    oauthTokenJson: decryptAntigravitySecret(row.oauth_token_encrypted, secrets.jwtSecret),
    acpAuthStateJson: decryptAntigravitySecret(row.acp_auth_state_encrypted, secrets.jwtSecret)
  };
}

export async function updateAntigravityCredentialTier(
  id: string,
  tierName: string | null,
  tierId: string | null
): Promise<void> {
  if (!tierName && !tierId) return;
  await query(
    `UPDATE antigravity_credentials
        SET tier_name = COALESCE($2, tier_name),
            tier_id = COALESCE($3, tier_id),
            updated_at = now()
      WHERE id = $1`,
    [id, tierName, tierId]
  );
}
