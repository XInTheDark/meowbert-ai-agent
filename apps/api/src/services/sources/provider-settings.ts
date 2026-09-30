import { isSourceProviderRuntimeEnabled } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import type { SourceProvider, SourceProviderSettings } from "./source-types.js";

interface SourceProviderSettingsRow {
  provider: SourceProvider;
  enabled: boolean;
  client_id: string | null;
  client_secret: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapSourceProviderSettings(row: SourceProviderSettingsRow): SourceProviderSettings {
  return {
    provider: row.provider,
    enabled: row.enabled,
    clientId: row.client_id,
    clientSecret: row.client_secret,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function isSourceProviderReady(
  settings: SourceProviderSettings | null,
  options?: { requiresCredentials?: boolean }
): settings is SourceProviderSettings {
  if (!settings || !settings.enabled || !isSourceProviderRuntimeEnabled(settings.provider)) {
    return false;
  }

  if (options?.requiresCredentials === false) {
    return true;
  }

  return typeof settings.clientId === "string"
    && settings.clientId.length > 0
    && typeof settings.clientSecret === "string"
    && settings.clientSecret.length > 0;
}

export function sanitizeSourceProviderSettingsForApi(
  settings: SourceProviderSettings,
  options?: { includeCredentials?: boolean }
) {
  return {
    provider: settings.provider,
    enabled: settings.enabled,
    clientId: options?.includeCredentials ? settings.clientId : null,
    clientSecret: options?.includeCredentials ? settings.clientSecret : null,
    hasClientId: typeof settings.clientId === "string" && settings.clientId.length > 0,
    hasClientSecret: typeof settings.clientSecret === "string" && settings.clientSecret.length > 0,
    updatedByUserId: settings.updatedByUserId,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt
  };
}

export async function listSourceProviderSettings(): Promise<SourceProviderSettings[]> {
  const result = await query<SourceProviderSettingsRow>(
    `SELECT provider,
            enabled,
            client_id,
            client_secret,
            updated_by_user_id,
            created_at::text,
            updated_at::text
       FROM source_provider_settings
      ORDER BY provider ASC`
  );

  return result.rows.map(mapSourceProviderSettings);
}

export async function getSourceProviderSettings(provider: SourceProvider): Promise<SourceProviderSettings | null> {
  const result = await query<SourceProviderSettingsRow>(
    `SELECT provider,
            enabled,
            client_id,
            client_secret,
            updated_by_user_id,
            created_at::text,
            updated_at::text
       FROM source_provider_settings
      WHERE provider = $1
      LIMIT 1`,
    [provider]
  );

  return result.rows[0] ? mapSourceProviderSettings(result.rows[0]) : null;
}

export async function upsertSourceProviderSettings(input: {
  provider: SourceProvider;
  enabled?: boolean;
  clientId?: string | null;
  clientSecret?: string | null;
  updatedByUserId: string;
}): Promise<SourceProviderSettings> {
  const existing = await getSourceProviderSettings(input.provider);
  const nextEnabled = typeof input.enabled === "boolean" ? input.enabled : (existing?.enabled ?? false);
  const nextClientId = input.clientId === undefined ? (existing?.clientId ?? null) : input.clientId?.trim() || null;
  const nextClientSecret = input.clientSecret === undefined ? (existing?.clientSecret ?? null) : input.clientSecret?.trim() || null;

  const result = await query<SourceProviderSettingsRow>(
    `INSERT INTO source_provider_settings (
       provider,
       enabled,
       client_id,
       client_secret,
       updated_by_user_id
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (provider)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       client_id = EXCLUDED.client_id,
       client_secret = EXCLUDED.client_secret,
       updated_by_user_id = EXCLUDED.updated_by_user_id,
       updated_at = now()
     RETURNING provider,
               enabled,
               client_id,
               client_secret,
               updated_by_user_id,
               created_at::text,
               updated_at::text`,
    [input.provider, nextEnabled, nextClientId, nextClientSecret, input.updatedByUserId]
  );

  return mapSourceProviderSettings(result.rows[0]);
}
