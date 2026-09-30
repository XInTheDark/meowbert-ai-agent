import { query } from "../../lib/db.js";

export type SharedConnectorType = "telegram" | "discord";
export type ConnectorConnectionMode = "custom" | "shared";
export type TelegramSharedIngestMode = "webhook" | "polling";

interface SharedConnectorSettingRow {
  connector_type: SharedConnectorType;
  enabled: boolean;
  bot_token: string | null;
  bot_user_id: string | null;
  telegram_ingest_mode: TelegramSharedIngestMode | null;
  telegram_last_update_id: number | null;
  telegram_webhook_secret: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SharedConnectorSetting {
  connectorType: SharedConnectorType;
  enabled: boolean;
  hasToken: boolean;
  botToken: string | null;
  botUserId: string | null;
  telegramIngestMode: TelegramSharedIngestMode;
  telegramLastUpdateId: number | null;
  telegramWebhookSecret: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapSharedConnectorSettingRow(row: SharedConnectorSettingRow): SharedConnectorSetting {
  return {
    connectorType: row.connector_type,
    enabled: row.enabled,
    hasToken: typeof row.bot_token === "string" && row.bot_token.length > 0,
    botToken: row.bot_token,
    botUserId: row.bot_user_id,
    telegramIngestMode: row.telegram_ingest_mode === "polling" ? "polling" : "webhook",
    telegramLastUpdateId:
      typeof row.telegram_last_update_id === "number" && Number.isInteger(row.telegram_last_update_id)
        ? row.telegram_last_update_id
        : null,
    telegramWebhookSecret: normalizeToken(row.telegram_webhook_secret),
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function defaultSharedConnectorSetting(type: SharedConnectorType): SharedConnectorSetting {
  return {
    connectorType: type,
    enabled: false,
    hasToken: false,
    botToken: null,
    botUserId: null,
    telegramIngestMode: "webhook",
    telegramLastUpdateId: null,
    telegramWebhookSecret: null,
    updatedByUserId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

export function normalizeConnectorConnectionMode(configJson: Record<string, unknown>): ConnectorConnectionMode {
  return configJson.connectionMode === "shared" ? "shared" : "custom";
}

export async function getSharedConnectorSetting(
  connectorType: SharedConnectorType
): Promise<SharedConnectorSetting> {
  const result = await query<SharedConnectorSettingRow>(
    `SELECT connector_type,
            enabled,
            bot_token,
            bot_user_id,
            telegram_ingest_mode,
            telegram_last_update_id,
            telegram_webhook_secret,
            updated_by_user_id,
            created_at::text,
            updated_at::text
       FROM shared_connector_settings
      WHERE connector_type = $1
      LIMIT 1`,
    [connectorType]
  );

  if ((result.rowCount ?? 0) === 0) {
    return defaultSharedConnectorSetting(connectorType);
  }

  return mapSharedConnectorSettingRow(result.rows[0]);
}

export async function listSharedConnectorSettings(): Promise<
  Record<SharedConnectorType, SharedConnectorSetting>
> {
  const result = await query<SharedConnectorSettingRow>(
    `SELECT connector_type,
            enabled,
            bot_token,
            bot_user_id,
            telegram_ingest_mode,
            telegram_last_update_id,
            telegram_webhook_secret,
            updated_by_user_id,
            created_at::text,
            updated_at::text
       FROM shared_connector_settings
      WHERE connector_type IN ('telegram', 'discord')`
  );

  const base: Record<SharedConnectorType, SharedConnectorSetting> = {
    telegram: defaultSharedConnectorSetting("telegram"),
    discord: defaultSharedConnectorSetting("discord")
  };

  for (const row of result.rows) {
    base[row.connector_type] = mapSharedConnectorSettingRow(row);
  }

  return base;
}

export async function upsertSharedConnectorSetting(input: {
  connectorType: SharedConnectorType;
  enabled: boolean;
  botToken: string | null;
  botUserId: string | null;
  telegramIngestMode?: TelegramSharedIngestMode;
  telegramLastUpdateId?: number | null;
  telegramWebhookSecret?: string | null;
  updatedByUserId: string | null;
}): Promise<SharedConnectorSetting> {
  const result = await query<SharedConnectorSettingRow>(
    `INSERT INTO shared_connector_settings (
      connector_type,
      enabled,
      bot_token,
      bot_user_id,
      telegram_ingest_mode,
      telegram_last_update_id,
      telegram_webhook_secret,
      updated_by_user_id,
      updated_at
    ) VALUES (
      $1,
      $2,
      $3,
      $4,
      CASE WHEN $1 = 'telegram' THEN $5::text ELSE NULL::text END,
      CASE WHEN $1 = 'telegram' THEN $6::integer ELSE NULL::integer END,
      CASE WHEN $1 = 'telegram' THEN $7::text ELSE NULL::text END,
      now()
    )
    ON CONFLICT (connector_type)
    DO UPDATE SET
      enabled = EXCLUDED.enabled,
      bot_token = EXCLUDED.bot_token,
      bot_user_id = EXCLUDED.bot_user_id,
      telegram_ingest_mode = CASE WHEN EXCLUDED.connector_type = 'telegram' THEN EXCLUDED.telegram_ingest_mode ELSE NULL::text END,
      telegram_last_update_id = CASE WHEN EXCLUDED.connector_type = 'telegram' THEN EXCLUDED.telegram_last_update_id ELSE NULL::integer END,
      telegram_webhook_secret = CASE WHEN EXCLUDED.connector_type = 'telegram' THEN EXCLUDED.telegram_webhook_secret ELSE NULL::text END,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = now()
    RETURNING connector_type,
              enabled,
              bot_token,
              bot_user_id,
              telegram_ingest_mode,
              telegram_last_update_id,
              telegram_webhook_secret,
              updated_by_user_id,
              created_at::text,
              updated_at::text`,
    [
      input.connectorType,
      input.enabled,
      normalizeToken(input.botToken),
      normalizeToken(input.botUserId),
      input.connectorType === "telegram" ? (input.telegramIngestMode ?? "webhook") : null,
      input.connectorType === "telegram" ? (input.telegramLastUpdateId ?? null) : null,
      input.connectorType === "telegram" ? normalizeToken(input.telegramWebhookSecret) : null,
      input.updatedByUserId
    ]
  );

  return mapSharedConnectorSettingRow(result.rows[0]);
}

export async function setSharedTelegramLastUpdateId(lastUpdateId: number): Promise<void> {
  await query(
    `UPDATE shared_connector_settings
        SET telegram_last_update_id = $1,
            updated_at = now()
      WHERE connector_type = 'telegram'`,
    [lastUpdateId]
  );
}

export async function getSharedConnectorTokenIfEnabled(
  connectorType: SharedConnectorType
): Promise<{ botToken: string; botUserId: string | null } | null> {
  const setting = await getSharedConnectorSetting(connectorType);
  if (!setting.enabled) {
    return null;
  }

  const token = normalizeToken(setting.botToken);
  if (!token) {
    return null;
  }

  return {
    botToken: token,
    botUserId: normalizeToken(setting.botUserId)
  };
}

export function sanitizeSharedConnectorForApi(
  setting: SharedConnectorSetting
): Omit<SharedConnectorSetting, "botToken" | "telegramWebhookSecret"> {
  return {
    connectorType: setting.connectorType,
    enabled: setting.enabled,
    hasToken: setting.hasToken,
    botUserId: setting.botUserId,
    telegramIngestMode: setting.telegramIngestMode,
    telegramLastUpdateId: setting.telegramLastUpdateId,
    updatedByUserId: setting.updatedByUserId,
    createdAt: setting.createdAt,
    updatedAt: setting.updatedAt
  };
}
