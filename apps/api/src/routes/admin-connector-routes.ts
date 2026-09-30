import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "../lib/config.js";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import { syncSharedDiscordBindingBotIdentity } from "../services/connectors/discord/discord-binding-state.js";
import { normalizeInboundDomain } from "../services/connectors/email/address-utils.js";
import {
  buildBrevoInboundWebhookUrl,
  ensureBrevoInboundWebhook
} from "../services/connectors/email/brevo-webhook.js";
import { listEmailInboundDebugEvents } from "../services/connectors/email/inbound-debug-events.js";
import {
  getEmailInboundSettings,
  sanitizeEmailInboundSettingsForApi,
  upsertEmailInboundSettings
} from "../services/connectors/email/inbound-settings.js";
import {
  getListmonkProviderSettings,
  sanitizeListmonkProviderSettingsForApi,
  testListmonkProviderConnection,
  upsertListmonkProviderSettings
} from "../services/connectors/email/provider-settings.js";
import { ensureListmonkTemplatesSynced } from "../services/connectors/email/template-sync.js";
import {
  getSharedConnectorSetting,
  sanitizeSharedConnectorForApi,
  type TelegramSharedIngestMode,
  upsertSharedConnectorSetting
} from "../services/connectors/shared-connectors.js";

const updateSharedDiscordSchema = z.object({
  enabled: z.boolean().optional(),
  botToken: z.string().nullable().optional()
});

const updateSharedTelegramSchema = z.object({
  enabled: z.boolean().optional(),
  botToken: z.string().nullable().optional(),
  ingestMode: z.enum(["webhook", "polling"]).optional()
});

const updateSharedListmonkSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().url().nullable().optional(),
  apiUsername: z.string().nullable().optional(),
  apiToken: z.string().nullable().optional()
});

const updateSharedEmailInboundSchema = z.object({
  enabled: z.boolean().optional(),
  inboundDomain: z.string().nullable().optional(),
  addressMode: z.enum(["random", "workspace_custom"]).optional(),
  webhookSecret: z.string().nullable().optional(),
  brevoApiKey: z.string().nullable().optional(),
  debugLoggingEnabled: z.boolean().optional()
});

const emailInboundDebugEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional()
});

interface DiscordBotInfo {
  id: string;
  bot?: boolean;
}

interface TelegramBotInfo {
  id: number;
}

async function validateDiscordBotToken(botToken: string): Promise<{ botUserId: string }> {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    method: "GET",
    headers: {
      authorization: `Bot ${botToken}`
    }
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Discord bot validation returned invalid JSON");
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload && typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : `Discord bot validation failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  const botInfo = payload as DiscordBotInfo;
  if (!botInfo?.id || botInfo.bot === false) {
    throw new Error("Discord token is not a valid bot token");
  }

  return {
    botUserId: botInfo.id
  };
}

async function validateTelegramBotToken(botToken: string): Promise<{ botUserId: string }> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
    method: "GET"
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Telegram bot validation returned invalid JSON");
  }

  if (!payload || typeof payload !== "object" || !("ok" in payload)) {
    throw new Error("Telegram bot validation returned unexpected payload");
  }

  const parsed = payload as { ok?: boolean; result?: TelegramBotInfo; description?: string };
  if (!response.ok || parsed.ok !== true || !parsed.result?.id) {
    throw new Error(parsed.description ?? `Telegram bot validation failed with HTTP ${response.status}`);
  }

  return {
    botUserId: String(parsed.result.id)
  };
}

function buildSharedTelegramWebhookUrl(): string {
  const trimmedPublicUrl = config.server.publicUrl.replace(/\/+$/, "");
  return `${trimmedPublicUrl}/api/connectors/telegram/shared/webhook`;
}

function generateTelegramWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}

async function syncSharedTelegramIngestMode(
  botToken: string,
  mode: TelegramSharedIngestMode,
  webhookSecret: string | null
): Promise<void> {
  if (mode === "webhook") {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        url: buildSharedTelegramWebhookUrl(),
        ...(webhookSecret ? { secret_token: webhookSecret } : {})
      })
    });

    const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.description ?? `Telegram webhook setup failed with HTTP ${response.status}`);
    }
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      drop_pending_updates: false
    })
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.description ?? `Telegram polling setup failed with HTTP ${response.status}`);
  }
}

function registerAdminConnectorSummaryRoute(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/admin/connectors/shared", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);

    const [discord, telegram, listmonk, emailInbound] = await Promise.all([
      getSharedConnectorSetting("discord"),
      getSharedConnectorSetting("telegram"),
      getListmonkProviderSettings(),
      getEmailInboundSettings()
    ]);
    const emailInboundForApi = sanitizeEmailInboundSettingsForApi(emailInbound);
    const emailInboundWebhookUrl = emailInbound.webhookSecret
      ? buildBrevoInboundWebhookUrl({
          apiBaseUrl: config.server.publicUrl,
          webhookSecret: emailInbound.webhookSecret
        })
      : null;

    return {
      connectors: {
        discord: sanitizeSharedConnectorForApi(discord),
        telegram: sanitizeSharedConnectorForApi(telegram),
        listmonk: sanitizeListmonkProviderSettingsForApi(listmonk),
        emailInbound: {
          ...emailInboundForApi,
          webhookUrl: emailInboundWebhookUrl
        }
      }
    };
  });
}

function registerAdminDiscordConnectorRoute(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.patch("/api/admin/connectors/shared/discord", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);

    const body = updateSharedDiscordSchema.parse(request.body);
    const existing = await getSharedConnectorSetting("discord");

    const nextEnabled = body.enabled ?? existing.enabled;
    const nextToken =
      body.botToken === undefined
        ? existing.botToken
        : body.botToken === null
          ? null
          : body.botToken.trim();

    const normalizedToken = typeof nextToken === "string" && nextToken.length > 0 ? nextToken : null;
    if (nextEnabled && !normalizedToken) {
      return reply.status(400).send({ error: "Shared Discord bot token is required when enabling connector." });
    }

    let botUserId: string | null = normalizedToken ? existing.botUserId : null;
    if (normalizedToken) {
      try {
        const validated = await validateDiscordBotToken(normalizedToken);
        botUserId = validated.botUserId;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(400).send({ error: message });
      }
    }

    const updated = await upsertSharedConnectorSetting({
      connectorType: "discord",
      enabled: nextEnabled,
      botToken: normalizedToken,
      botUserId,
      updatedByUserId: request.user.id
    });

    const previousActiveBotUserId = existing.enabled ? existing.botUserId : null;
    const nextActiveBotUserId = updated.enabled ? updated.botUserId : null;
    if (previousActiveBotUserId !== nextActiveBotUserId) {
      await syncSharedDiscordBindingBotIdentity(nextActiveBotUserId);
    }

    return {
      connector: sanitizeSharedConnectorForApi(updated)
    };
  });
}

function registerAdminTelegramConnectorRoute(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.patch("/api/admin/connectors/shared/telegram", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);

    const body = updateSharedTelegramSchema.parse(request.body);
    const existing = await getSharedConnectorSetting("telegram");

    const nextEnabled = body.enabled ?? existing.enabled;
    const nextIngestMode: TelegramSharedIngestMode = body.ingestMode ?? existing.telegramIngestMode;
    const nextToken =
      body.botToken === undefined
        ? existing.botToken
        : body.botToken === null
          ? null
          : body.botToken.trim();

    const normalizedToken = typeof nextToken === "string" && nextToken.length > 0 ? nextToken : null;
    if (nextEnabled && !normalizedToken) {
      return reply.status(400).send({ error: "Shared Telegram bot token is required when enabling connector." });
    }

    let botUserId: string | null = normalizedToken ? existing.botUserId : null;
    const nextWebhookSecret = normalizedToken
      ? (existing.telegramWebhookSecret ?? generateTelegramWebhookSecret())
      : null;
    if (normalizedToken) {
      try {
        const validated = await validateTelegramBotToken(normalizedToken);
        botUserId = validated.botUserId;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(400).send({ error: message });
      }
    }

    if (nextEnabled && normalizedToken) {
      try {
        await syncSharedTelegramIngestMode(normalizedToken, nextIngestMode, nextWebhookSecret);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(502).send({ error: message });
      }
    }

    const updated = await upsertSharedConnectorSetting({
      connectorType: "telegram",
      enabled: nextEnabled,
      botToken: normalizedToken,
      botUserId,
      telegramIngestMode: nextIngestMode,
      telegramLastUpdateId: nextIngestMode === "polling" ? existing.telegramLastUpdateId : null,
      telegramWebhookSecret: nextWebhookSecret,
      updatedByUserId: request.user.id
    });

    return {
      connector: sanitizeSharedConnectorForApi(updated)
    };
  });
}

function registerAdminListmonkConnectorRoute(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.patch("/api/admin/connectors/shared/listmonk", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);

    if (!config.email.enabled) {
      return reply.status(400).send({ error: "Email is disabled in server config. Enable config.email.enabled first." });
    }

    const body = updateSharedListmonkSchema.parse(request.body);
    const existing = await getListmonkProviderSettings();

    const nextEnabled = body.enabled ?? existing.enabled;
    const nextBaseUrl =
      body.baseUrl === undefined
        ? existing.baseUrl
        : body.baseUrl === null
          ? null
          : body.baseUrl.trim();
    const nextApiUsername =
      body.apiUsername === undefined
        ? existing.apiUsername
        : body.apiUsername === null
          ? null
          : body.apiUsername.trim();
    const nextApiToken =
      body.apiToken === undefined
        ? existing.apiToken
        : body.apiToken === null
          ? null
          : body.apiToken.trim();

    const normalizedBaseUrl = nextBaseUrl && nextBaseUrl.length > 0 ? nextBaseUrl : null;
    const normalizedApiUsername = nextApiUsername && nextApiUsername.length > 0 ? nextApiUsername : null;
    const normalizedApiToken = nextApiToken && nextApiToken.length > 0 ? nextApiToken : null;

    if (nextEnabled && (!normalizedBaseUrl || !normalizedApiUsername || !normalizedApiToken)) {
      return reply.status(400).send({ error: "Listmonk base URL, API username, and API token are required when enabled." });
    }

    if (nextEnabled && normalizedBaseUrl && normalizedApiUsername && normalizedApiToken) {
      try {
        await testListmonkProviderConnection({
          baseUrl: normalizedBaseUrl,
          apiUsername: normalizedApiUsername,
          apiToken: normalizedApiToken
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(400).send({ error: `Listmonk API auth failed: ${message}` });
      }
    }

    const updated = await upsertListmonkProviderSettings({
      enabled: nextEnabled,
      baseUrl: normalizedBaseUrl,
      apiUsername: normalizedApiUsername,
      apiToken: normalizedApiToken,
      updatedByUserId: request.user.id
    });

    let warning: string | null = null;
    if (updated.enabled) {
      try {
        await ensureListmonkTemplatesSynced({ requireConfigured: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warning = `Settings were saved, but template sync failed: ${message}`;
      }
    }

    return {
      connector: sanitizeListmonkProviderSettingsForApi(updated),
      ...(warning ? { warning } : {})
    };
  });
}

function registerAdminEmailInboundSettingsRoute(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.patch("/api/admin/connectors/shared/email-inbound", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);

    if (!config.connectors.email.enabled) {
      return reply.status(400).send({ error: "Email connector is disabled in server config." });
    }

    const body = updateSharedEmailInboundSchema.parse(request.body);
    const existing = await getEmailInboundSettings();

    const nextEnabled = body.enabled ?? existing.enabled;
    const nextInboundDomain =
      body.inboundDomain === undefined
        ? existing.inboundDomain
        : body.inboundDomain === null
          ? null
          : body.inboundDomain.trim();
    const nextAddressMode = body.addressMode ?? existing.addressMode;
    const nextWebhookSecret =
      body.webhookSecret === undefined
        ? existing.webhookSecret
        : body.webhookSecret === null
          ? null
          : body.webhookSecret.trim();
    const nextBrevoApiKey =
      body.brevoApiKey === undefined
        ? existing.brevoApiKey
        : body.brevoApiKey === null
          ? null
          : body.brevoApiKey.trim();

    const normalizedInboundDomain = normalizeInboundDomain(nextInboundDomain);
    const normalizedWebhookSecret =
      typeof nextWebhookSecret === "string" && nextWebhookSecret.length > 0 ? nextWebhookSecret : null;
    const normalizedBrevoApiKey =
      typeof nextBrevoApiKey === "string" && nextBrevoApiKey.length > 0 ? nextBrevoApiKey : null;
    const nextDebugLoggingEnabled = body.debugLoggingEnabled ?? existing.debugLoggingEnabled;

    if (nextEnabled && !normalizedInboundDomain) {
      return reply.status(400).send({ error: "Inbound domain is required when enabling email inbound." });
    }

    if (nextEnabled && !normalizedWebhookSecret) {
      return reply.status(400).send({ error: "Webhook secret is required when enabling email inbound." });
    }

    if (nextEnabled && !normalizedBrevoApiKey) {
      return reply.status(400).send({ error: "Brevo API key is required when enabling email inbound." });
    }

    const updated = await upsertEmailInboundSettings({
      enabled: nextEnabled,
      inboundDomain: normalizedInboundDomain,
      addressMode: nextAddressMode,
      webhookSecret: normalizedWebhookSecret,
      brevoApiKey: normalizedBrevoApiKey,
      debugLoggingEnabled: nextDebugLoggingEnabled,
      updatedByUserId: request.user.id
    });

    const connectorForApi = sanitizeEmailInboundSettingsForApi(updated);
    const webhookUrl = updated.webhookSecret
      ? buildBrevoInboundWebhookUrl({
          apiBaseUrl: config.server.publicUrl,
          webhookSecret: updated.webhookSecret
        })
      : null;

    return {
      connector: {
        ...connectorForApi,
        webhookUrl
      }
    };
  });
}

function registerAdminEmailInboundOperationsRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.post(
    "/api/admin/connectors/shared/email-inbound/brevo-webhook/sync",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      await assertSuperAdmin(request.user.id);

      if (!config.connectors.email.enabled) {
        return reply.status(400).send({ error: "Email connector is disabled in server config." });
      }

      const settings = await getEmailInboundSettings();

      if (!settings.enabled) {
        return reply.status(409).send({ error: "Email inbound is disabled. Enable it before syncing Brevo webhook." });
      }
      if (!settings.inboundDomain) {
        return reply.status(409).send({ error: "Inbound domain is missing. Save Email Inbound settings first." });
      }
      if (!settings.webhookSecret) {
        return reply.status(409).send({ error: "Webhook token is missing. Save Email Inbound settings first." });
      }
      if (!settings.brevoApiKey) {
        return reply.status(409).send({ error: "Brevo API key is missing. Save Email Inbound settings first." });
      }

      const webhookUrl = buildBrevoInboundWebhookUrl({
        apiBaseUrl: config.server.publicUrl,
        webhookSecret: settings.webhookSecret
      });

      try {
        const syncResult = await ensureBrevoInboundWebhook({
          apiKey: settings.brevoApiKey,
          inboundDomain: settings.inboundDomain,
          webhookUrl
        });

        return {
          action: syncResult.action,
          webhook: syncResult.webhook
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        request.log.error({ err: error }, "Brevo webhook sync failed");
        return reply.status(502).send({
          error: `Brevo webhook sync failed: ${message}`,
          details: message
        });
      }
    }
  );

  fastify.get(
    "/api/admin/connectors/shared/email-inbound/debug-events",
    { preHandler: fastify.authenticate },
    async (request) => {
      await assertSuperAdmin(request.user.id);
      const queryParams = emailInboundDebugEventsQuerySchema.parse(request.query);

      const events = await listEmailInboundDebugEvents({
        limit: queryParams.limit ?? 200
      });

      return { events };
    }
  );
}

export function registerAdminConnectorRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  registerAdminConnectorSummaryRoute(fastify);
  registerAdminDiscordConnectorRoute(fastify);
  registerAdminTelegramConnectorRoute(fastify);
  registerAdminListmonkConnectorRoute(fastify);
  registerAdminEmailInboundSettingsRoute(fastify);
  registerAdminEmailInboundOperationsRoutes(fastify);
}
