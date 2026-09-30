import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { query } from "../../lib/db.js";
import { config } from "../../lib/config.js";
import {
  getTelegramBindingById,
  processTelegramUpdateForBinding,
  type TelegramUpdate
} from "../../services/connectors/telegram/index.js";
import { processSharedTelegramUpdate } from "../../services/connectors/telegram/telegram-shared.js";
import { getSharedConnectorSetting } from "../../services/connectors/shared-connectors.js";
import { assertWorkspaceOwner } from "../../services/workspaces/workspace-access.js";
import { normalizeConnectorAgentId } from "../../services/connectors/connector-agent.js";
import { normalizeConnectorToolOptionsConfig } from "../../services/connectors/connector-tools.js";
import { isEnvironmentMemoryEnabled } from "../../services/environments/environment-memory.js";
import { workspaceParams, buildTelegramWebhookUrl, connectorToolOptionsSchema } from "./shared.js";

interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name?: string;
  username?: string;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  description?: string;
  result?: T;
}

async function callTelegramApi<T>(
  botToken: string,
  method: string,
  payload?: Record<string, unknown>
): Promise<TelegramApiResponse<T>> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: payload ? "POST" : "GET",
    headers: payload
      ? {
          "content-type": "application/json"
        }
      : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    return {
      ok: false,
      description: `Telegram API ${method} returned an invalid response`
    };
  }

  if (!parsedBody || typeof parsedBody !== "object" || !("ok" in parsedBody)) {
    return {
      ok: false,
      description: `Telegram API ${method} returned an unexpected payload`
    };
  }

  const telegramPayload = parsedBody as TelegramApiResponse<T>;
  if (!response.ok || telegramPayload.ok !== true) {
    return {
      ok: false,
      description:
        telegramPayload.description ??
        `Telegram API ${method} failed with HTTP ${response.status}`
    };
  }

  return telegramPayload;
}

function generateTelegramWebhookSecret(): string {
  return randomBytes(24).toString("hex");
}

function extractWebhookSecretHeader(headers: Record<string, unknown>): string | null {
  const headerValue = headers["x-telegram-bot-api-secret-token"];
  if (typeof headerValue === "string" && headerValue.trim().length > 0) {
    return headerValue.trim();
  }
  if (Array.isArray(headerValue)) {
    const first = headerValue.find((entry) => typeof entry === "string" && entry.trim().length > 0);
    return typeof first === "string" ? first.trim() : null;
  }
  return null;
}

export const telegramConnectorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/api/workspaces/:wsId/connectors/telegram",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!config.connectors.telegram.enabled) {
        return reply.status(400).send({ error: "Telegram connector is disabled on this server" });
      }

      const params = workspaceParams.parse(request.params);
      await assertWorkspaceOwner(params.wsId, request.user.id);

      const body = z
        .object({
          connectionMode: z.enum(["custom", "shared"]).default("custom"),
          botToken: z.string().optional(),
          defaultEnvironmentId: z.string().uuid().optional(),
          mode: z.enum(["webhook", "polling"]).default("webhook"),
          agentId: z.string().max(200).nullable().optional(),
          tools: connectorToolOptionsSchema.optional(),
          prefixEnabled: z.boolean().default(true),
          keywordEnabled: z.boolean().default(true),
          llmFallbackEnabled: z.boolean().default(true)
        })
        .parse(request.body);

      const memoryEnabled = body.defaultEnvironmentId ? await isEnvironmentMemoryEnabled(body.defaultEnvironmentId) : false;

      if (body.connectionMode === "shared") {
        const sharedSetting = await getSharedConnectorSetting("telegram");
        if (!sharedSetting.enabled || !sharedSetting.hasToken) {
          return reply.status(409).send({
            error: "Shared Telegram bot is not enabled by the platform admin"
          });
        }

        const connectorConfig = {
          connectionMode: "shared" as const,
          defaultEnvironmentId: body.defaultEnvironmentId,
          mode: "shared" as const,
          agentId: normalizeConnectorAgentId(body.agentId),
          tools: normalizeConnectorToolOptionsConfig(body.tools, memoryEnabled),
          prefixEnabled: body.prefixEnabled,
          keywordEnabled: body.keywordEnabled,
          llmFallbackEnabled: body.llmFallbackEnabled
        };

        const result = await query<{ id: string }>(
          `INSERT INTO connector_bindings (workspace_id, type, status, config_json)
           VALUES ($1, 'telegram', 'active', $2::jsonb)
           ON CONFLICT (workspace_id, type)
           DO UPDATE SET
             status = 'active',
             config_json = EXCLUDED.config_json,
             updated_at = now()
           RETURNING id`,
          [params.wsId, JSON.stringify(connectorConfig)]
        );

        return reply.send({
          id: result.rows[0].id,
          webhookUrl: null,
          mode: "shared",
          bot: sharedSetting.botUserId
            ? {
                id: Number.parseInt(sharedSetting.botUserId, 10) || null,
                username: null,
                firstName: null
              }
            : null
        });
      }

      const botToken = (body.botToken ?? "").trim();
      if (!botToken) {
        return reply.status(400).send({ error: "Telegram bot token is required for custom mode" });
      }

      const mode = body.mode;
      let botInfo: TelegramBotInfo | null = null;
      try {
        const getMeResponse = await callTelegramApi<TelegramBotInfo>(botToken, "getMe");
        if (!getMeResponse.ok || !getMeResponse.result) {
          return reply
            .status(400)
            .send({ error: getMeResponse.description ?? "Invalid Telegram bot token" });
        }

        botInfo = getMeResponse.result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(502).send({ error: `Telegram bot validation failed: ${message}` });
      }

      const existingBindingRes = await query<{
        config_json: Record<string, unknown>;
      }>(
        `SELECT config_json
           FROM connector_bindings
          WHERE workspace_id = $1
            AND type = 'telegram'`,
        [params.wsId]
      );
      const existingConfig = existingBindingRes.rows[0]?.config_json;
      const existingLastUpdateId =
        typeof existingConfig?.lastUpdateId === "number" && Number.isInteger(existingConfig.lastUpdateId)
          ? existingConfig.lastUpdateId
          : null;
      const existingBotToken = typeof existingConfig?.botToken === "string" ? existingConfig.botToken : null;
      const existingWebhookSecret = typeof existingConfig?.webhookSecret === "string" ? existingConfig.webhookSecret : null;
      const webhookSecret = existingWebhookSecret ?? generateTelegramWebhookSecret();

      const connectorConfig = {
        connectionMode: "custom" as const,
        botToken,
        webhookSecret,
        defaultEnvironmentId: body.defaultEnvironmentId,
        mode,
        agentId: normalizeConnectorAgentId(body.agentId),
        tools: normalizeConnectorToolOptionsConfig(body.tools, memoryEnabled),
        prefixEnabled: body.prefixEnabled,
        keywordEnabled: body.keywordEnabled,
        llmFallbackEnabled: body.llmFallbackEnabled,
        ...(existingBotToken === botToken && existingLastUpdateId !== null
          ? { lastUpdateId: existingLastUpdateId }
          : {})
      };

      const result = await query<{ id: string }>(
        `INSERT INTO connector_bindings (workspace_id, type, status, config_json)
         VALUES ($1, 'telegram', 'setup_pending', $2::jsonb)
         ON CONFLICT (workspace_id, type)
         DO UPDATE SET
           status = 'setup_pending',
           config_json = EXCLUDED.config_json,
           updated_at = now()
         RETURNING id`,
        [params.wsId, JSON.stringify(connectorConfig)]
      );

      const bindingId = result.rows[0].id;
      const webhookUrl = buildTelegramWebhookUrl(bindingId);

      try {
        if (mode === "webhook") {
          const setWebhookResponse = await callTelegramApi<boolean>(botToken, "setWebhook", {
            url: webhookUrl,
            secret_token: webhookSecret
          });

          if (!setWebhookResponse.ok || setWebhookResponse.result !== true) {
            throw new Error(setWebhookResponse.description ?? "Unable to register webhook");
          }
        } else {
          const deleteWebhookResponse = await callTelegramApi<boolean>(botToken, "deleteWebhook", {
            drop_pending_updates: false
          });
          if (!deleteWebhookResponse.ok || deleteWebhookResponse.result !== true) {
            throw new Error(deleteWebhookResponse.description ?? "Unable to enable polling mode");
          }
        }

        await query(
          `UPDATE connector_bindings
              SET status = 'active',
                  updated_at = now()
            WHERE id = $1`,
          [bindingId]
        );
      } catch (error) {
        await query(
          `UPDATE connector_bindings
              SET status = 'error',
                  updated_at = now()
            WHERE id = $1`,
          [bindingId]
        );

        const message = error instanceof Error ? error.message : String(error);
        return reply.status(502).send({
          error: mode === "webhook" ? `Telegram webhook setup failed: ${message}` : `Telegram polling setup failed: ${message}`,
          id: bindingId,
          webhookUrl
        });
      }

      return reply.send({
        id: bindingId,
        webhookUrl,
        mode,
        bot: botInfo
          ? {
              id: botInfo.id,
              username: botInfo.username ?? null,
              firstName: botInfo.first_name ?? null
            }
          : null
      });
    }
  );

  fastify.post("/api/connectors/telegram/shared/webhook", async (request, reply) => {
    if (!config.connectors.telegram.enabled) {
      return reply.status(404).send({ error: "Telegram connector is disabled" });
    }

    const sharedSetting = await getSharedConnectorSetting("telegram");
    if (!sharedSetting.enabled || !sharedSetting.hasToken) {
      return reply.status(404).send({ error: "Shared Telegram connector is not active" });
    }
    if (sharedSetting.telegramIngestMode !== "webhook") {
      return reply.status(409).send({ error: "Shared Telegram connector is not in webhook mode" });
    }
    if (sharedSetting.telegramWebhookSecret) {
      const secretHeader = extractWebhookSecretHeader(request.headers as Record<string, unknown>);
      if (secretHeader !== sharedSetting.telegramWebhookSecret) {
        return reply.status(403).send({ error: "Invalid Telegram webhook secret" });
      }
    }

    const update = request.body as TelegramUpdate;
    const processed = await processSharedTelegramUpdate({
      update,
      sharedBotToken: sharedSetting.botToken
    });
    if (!processed.processed) {
      return reply.send({ ok: true });
    }

    return reply.send({
      ok: true,
      taskId: processed.taskId,
      environmentId: processed.environmentId,
      action: processed.action
    });
  });

  fastify.post("/api/connectors/telegram/:bindingId/webhook", async (request, reply) => {
    if (!config.connectors.telegram.enabled) {
      return reply.status(404).send({ error: "Telegram connector is disabled" });
    }

    const params = z.object({ bindingId: z.string().uuid() }).parse(request.params);
    const update = request.body as TelegramUpdate;
    const binding = await getTelegramBindingById(params.bindingId);
    if (!binding || binding.status !== "active") {
      return reply.status(404).send({ error: "Binding not found" });
    }
    const modeRaw = binding.config_json.mode;
    if (modeRaw === "shared") {
      return reply.status(409).send({ error: "Binding is configured for shared mode" });
    }
    const mode = modeRaw === "polling" ? "polling" : "webhook";
    if (mode !== "webhook") {
      return reply.status(409).send({ error: "Binding is not in webhook mode" });
    }
    const webhookSecret =
      typeof binding.config_json.webhookSecret === "string" && binding.config_json.webhookSecret.trim().length > 0
        ? binding.config_json.webhookSecret.trim()
        : null;
    if (webhookSecret) {
      const secretHeader = extractWebhookSecretHeader(request.headers as Record<string, unknown>);
      if (secretHeader !== webhookSecret) {
        return reply.status(403).send({ error: "Invalid Telegram webhook secret" });
      }
    }

    const processed = await processTelegramUpdateForBinding(binding, update);
    if (!processed.processed) {
      return reply.send({ ok: true });
    }

    return reply.send({
      ok: true,
      taskId: processed.taskId,
      environmentId: processed.environmentId,
      action: processed.action
    });
  });
};
