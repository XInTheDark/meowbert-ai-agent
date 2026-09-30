import { ListmonkClient, type ListmonkClientConfig } from "@meowbert/shared";
import { query } from "../../../lib/db.js";

interface EmailProviderSettingRow {
  provider: "listmonk";
  enabled: boolean;
  base_url: string | null;
  api_username: string | null;
  api_token: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListmonkProviderSettings {
  provider: "listmonk";
  enabled: boolean;
  baseUrl: string | null;
  apiUsername: string | null;
  hasApiToken: boolean;
  apiToken: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapRow(row: EmailProviderSettingRow | undefined): ListmonkProviderSettings {
  if (!row) {
    const epoch = new Date(0).toISOString();
    return {
      provider: "listmonk",
      enabled: false,
      baseUrl: null,
      apiUsername: null,
      hasApiToken: false,
      apiToken: null,
      updatedByUserId: null,
      createdAt: epoch,
      updatedAt: epoch
    };
  }

  return {
    provider: "listmonk",
    enabled: row.enabled,
    baseUrl: normalizeOptionalText(row.base_url),
    apiUsername: normalizeOptionalText(row.api_username),
    hasApiToken: typeof row.api_token === "string" && row.api_token.length > 0,
    apiToken: normalizeOptionalText(row.api_token),
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function sanitizeListmonkProviderSettingsForApi(
  settings: ListmonkProviderSettings
): Omit<ListmonkProviderSettings, "apiToken"> {
  return {
    provider: settings.provider,
    enabled: settings.enabled,
    baseUrl: settings.baseUrl,
    apiUsername: settings.apiUsername,
    hasApiToken: settings.hasApiToken,
    updatedByUserId: settings.updatedByUserId,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt
  };
}

export async function getListmonkProviderSettings(): Promise<ListmonkProviderSettings> {
  const result = await query<EmailProviderSettingRow>(
    `SELECT provider,
            enabled,
            base_url,
            api_username,
            api_token,
            updated_by_user_id,
            created_at::text,
            updated_at::text
       FROM email_provider_settings
      WHERE provider = 'listmonk'
      LIMIT 1`
  );

  return mapRow(result.rows[0]);
}

export function resolveListmonkClientConfig(
  settings: ListmonkProviderSettings
): ListmonkClientConfig | null {
  if (!settings.enabled) {
    return null;
  }

  if (!settings.baseUrl || !settings.apiUsername || !settings.apiToken) {
    return null;
  }

  return {
    baseUrl: settings.baseUrl,
    username: settings.apiUsername,
    password: settings.apiToken,
    timeoutMs: 10_000
  };
}

export async function getListmonkClientConfig(): Promise<ListmonkClientConfig | null> {
  const settings = await getListmonkProviderSettings();
  return resolveListmonkClientConfig(settings);
}

export async function upsertListmonkProviderSettings(input: {
  enabled: boolean;
  baseUrl: string | null;
  apiUsername: string | null;
  apiToken: string | null;
  updatedByUserId: string | null;
}): Promise<ListmonkProviderSettings> {
  const result = await query<EmailProviderSettingRow>(
    `INSERT INTO email_provider_settings (
      provider,
      enabled,
      base_url,
      api_username,
      api_token,
      updated_by_user_id,
      updated_at
    )
    VALUES ('listmonk', $1, $2, $3, $4, $5, now())
    ON CONFLICT (provider)
    DO UPDATE SET
      enabled = EXCLUDED.enabled,
      base_url = EXCLUDED.base_url,
      api_username = EXCLUDED.api_username,
      api_token = EXCLUDED.api_token,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = now()
    RETURNING provider,
              enabled,
              base_url,
              api_username,
              api_token,
              updated_by_user_id,
              created_at::text,
              updated_at::text`,
    [
      input.enabled,
      normalizeOptionalText(input.baseUrl),
      normalizeOptionalText(input.apiUsername),
      normalizeOptionalText(input.apiToken),
      input.updatedByUserId
    ]
  );

  return mapRow(result.rows[0]);
}

export async function testListmonkProviderConnection(input: {
  baseUrl: string;
  apiUsername: string;
  apiToken: string;
}): Promise<void> {
  const client = new ListmonkClient({
    baseUrl: input.baseUrl,
    username: input.apiUsername,
    password: input.apiToken,
    timeoutMs: 10_000
  });

  await client.listTemplates();
}
