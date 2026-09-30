import type { ListmonkClientConfig } from "@meowbert/shared";
import { query } from "../../lib/db.js";

interface EmailProviderSettingRow {
  enabled: boolean;
  base_url: string | null;
  api_username: string | null;
  api_token: string | null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getListmonkClientConfigFromDb(): Promise<ListmonkClientConfig | null> {
  const result = await query<EmailProviderSettingRow>(
    `SELECT enabled, base_url, api_username, api_token
       FROM email_provider_settings
      WHERE provider = 'listmonk'
      LIMIT 1`
  );

  const row = result.rows[0];
  if (!row || !row.enabled) {
    return null;
  }

  const baseUrl = normalizeOptionalText(row.base_url);
  const username = normalizeOptionalText(row.api_username);
  const password = normalizeOptionalText(row.api_token);

  if (!baseUrl || !username || !password) {
    return null;
  }

  return {
    baseUrl,
    username,
    password,
    timeoutMs: 10_000
  };
}
