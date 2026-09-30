import { query } from "../../../lib/db.js";
import { normalizeInboundDomain } from "./address-utils.js";

export type EmailInboundProvider = "brevo";
export type EmailAddressMode = "random" | "workspace_custom";

interface EmailInboundSettingsRow {
  provider: EmailInboundProvider;
  enabled: boolean;
  inbound_domain: string | null;
  address_mode: EmailAddressMode;
  webhook_secret: string | null;
  brevo_api_key: string | null;
  debug_logging_enabled: boolean;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailInboundSettings {
  provider: EmailInboundProvider;
  enabled: boolean;
  inboundDomain: string | null;
  addressMode: EmailAddressMode;
  webhookSecret: string | null;
  hasWebhookSecret: boolean;
  brevoApiKey: string | null;
  hasBrevoApiKey: boolean;
  debugLoggingEnabled: boolean;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailInboundSettingsForApi {
  provider: EmailInboundProvider;
  enabled: boolean;
  inboundDomain: string | null;
  addressMode: EmailAddressMode;
  hasWebhookSecret: boolean;
  hasBrevoApiKey: boolean;
  debugLoggingEnabled: boolean;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  webhookSecret?: string | null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapRow(row: EmailInboundSettingsRow | undefined): EmailInboundSettings {
  if (!row) {
    const epoch = new Date(0).toISOString();
    return {
      provider: "brevo",
      enabled: false,
      inboundDomain: null,
      addressMode: "random",
      webhookSecret: null,
      hasWebhookSecret: false,
      brevoApiKey: null,
      hasBrevoApiKey: false,
      debugLoggingEnabled: false,
      updatedByUserId: null,
      createdAt: epoch,
      updatedAt: epoch
    };
  }

  const webhookSecret = normalizeOptionalText(row.webhook_secret);
  const brevoApiKey = normalizeOptionalText(row.brevo_api_key);

  return {
    provider: "brevo",
    enabled: row.enabled,
    inboundDomain: normalizeInboundDomain(row.inbound_domain),
    addressMode: row.address_mode === "workspace_custom" ? "workspace_custom" : "random",
    webhookSecret,
    hasWebhookSecret: Boolean(webhookSecret),
    brevoApiKey,
    hasBrevoApiKey: Boolean(brevoApiKey),
    debugLoggingEnabled: row.debug_logging_enabled === true,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function sanitizeEmailInboundSettingsForApi(
  settings: EmailInboundSettings,
  options?: {
    includeWebhookSecret?: boolean;
  }
): EmailInboundSettingsForApi {
  const base: EmailInboundSettingsForApi = {
    provider: settings.provider,
    enabled: settings.enabled,
    inboundDomain: settings.inboundDomain,
    addressMode: settings.addressMode,
    hasWebhookSecret: settings.hasWebhookSecret,
    hasBrevoApiKey: settings.hasBrevoApiKey,
    debugLoggingEnabled: settings.debugLoggingEnabled,
    updatedByUserId: settings.updatedByUserId,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt
  };

  if (options?.includeWebhookSecret === true) {
    return {
      ...base,
      webhookSecret: settings.webhookSecret
    };
  }

  return base;
}

export async function getEmailInboundSettings(): Promise<EmailInboundSettings> {
  const result = await query<EmailInboundSettingsRow>(
    `SELECT provider,
            enabled,
            inbound_domain,
            address_mode,
            webhook_secret,
            brevo_api_key,
            debug_logging_enabled,
            updated_by_user_id,
            created_at::text,
            updated_at::text
       FROM email_inbound_settings
      WHERE provider = 'brevo'
      LIMIT 1`
  );

  return mapRow(result.rows[0]);
}

export async function upsertEmailInboundSettings(input: {
  enabled: boolean;
  inboundDomain: string | null;
  addressMode: EmailAddressMode;
  webhookSecret: string | null;
  brevoApiKey: string | null;
  debugLoggingEnabled: boolean;
  updatedByUserId: string | null;
}): Promise<EmailInboundSettings> {
  const result = await query<EmailInboundSettingsRow>(
    `INSERT INTO email_inbound_settings (
      provider,
      enabled,
      inbound_domain,
      address_mode,
      webhook_secret,
      brevo_api_key,
      debug_logging_enabled,
      updated_by_user_id,
      updated_at
    ) VALUES (
      'brevo',
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      now()
    )
    ON CONFLICT (provider)
    DO UPDATE SET
      enabled = EXCLUDED.enabled,
      inbound_domain = EXCLUDED.inbound_domain,
      address_mode = EXCLUDED.address_mode,
      webhook_secret = EXCLUDED.webhook_secret,
      brevo_api_key = EXCLUDED.brevo_api_key,
      debug_logging_enabled = EXCLUDED.debug_logging_enabled,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = now()
    RETURNING provider,
              enabled,
              inbound_domain,
              address_mode,
              webhook_secret,
              brevo_api_key,
              debug_logging_enabled,
              updated_by_user_id,
              created_at::text,
              updated_at::text`,
    [
      input.enabled,
      normalizeInboundDomain(input.inboundDomain),
      input.addressMode,
      normalizeOptionalText(input.webhookSecret),
      normalizeOptionalText(input.brevoApiKey),
      input.debugLoggingEnabled,
      input.updatedByUserId
    ]
  );

  return mapRow(result.rows[0]);
}
