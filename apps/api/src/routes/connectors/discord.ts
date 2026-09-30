import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { withTransaction } from "../../lib/db.js";
import { config } from "../../lib/config.js";
import {
  clearDiscordConnectorRoutingState,
  hasDiscordBindingOwnerChanged
} from "../../services/connectors/discord/discord-binding-state.js";
import { getSharedConnectorSetting } from "../../services/connectors/shared-connectors.js";
import { assertWorkspaceOwner } from "../../services/workspaces/workspace-access.js";
import { normalizeConnectorAgentId } from "../../services/connectors/connector-agent.js";
import { normalizeConnectorToolOptionsConfig } from "../../services/connectors/connector-tools.js";
import { isEnvironmentMemoryEnabled } from "../../services/environments/environment-memory.js";
import { workspaceParams, connectorToolOptionsSchema } from "./shared.js";

interface DiscordBotInfo {
  id: string;
  username?: string;
  global_name?: string | null;
  bot?: boolean;
}

interface DiscordApiErrorResponse {
  message?: string;
}

async function callDiscordApi<T>(
  botToken: string,
  path: string,
  options?: {
    method?: "GET" | "POST";
    payload?: Record<string, unknown>;
  }
): Promise<{ ok: boolean; description?: string; result?: T }> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method: options?.method ?? (options?.payload ? "POST" : "GET"),
    headers: {
      authorization: `Bot ${botToken}`,
      ...(options?.payload
        ? {
            "content-type": "application/json"
          }
        : {})
    },
    body: options?.payload ? JSON.stringify(options.payload) : undefined
  });

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    return {
      ok: false,
      description: `Discord API ${path} returned an invalid response`
    };
  }

  if (!response.ok) {
    const discordPayload = parsedBody as DiscordApiErrorResponse | null;
    return {
      ok: false,
      description:
        discordPayload && typeof discordPayload.message === "string"
          ? discordPayload.message
          : `Discord API ${path} failed with HTTP ${response.status}`
    };
  }

  return {
    ok: true,
    result: parsedBody as T
  };
}

export const discordConnectorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/api/workspaces/:wsId/connectors/discord",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      if (!config.connectors.discord.enabled) {
        return reply.status(400).send({ error: "Discord connector is disabled on this server" });
      }

      const params = workspaceParams.parse(request.params);
      await assertWorkspaceOwner(params.wsId, request.user.id);

      const body = z
        .object({
          connectionMode: z.enum(["custom", "shared"]).default("custom"),
          botToken: z.string().optional(),
          defaultEnvironmentId: z.string().uuid().optional(),
          agentId: z.string().max(200).nullable().optional(),
          tools: connectorToolOptionsSchema.optional(),
          prefixEnabled: z.boolean().default(true),
          keywordEnabled: z.boolean().default(true),
          llmFallbackEnabled: z.boolean().default(true),
          channelHistoryEnabled: z.boolean().default(false),
          channelHistoryMaxChars: z.number().int().positive().max(2_000_000).optional(),
          channelHistoryIncludePinnedMessages: z.boolean().default(true)
        })
        .parse(request.body);

      const memoryEnabled = body.defaultEnvironmentId ? await isEnvironmentMemoryEnabled(body.defaultEnvironmentId) : false;

      if (body.connectionMode === "shared") {
        const sharedSetting = await getSharedConnectorSetting("discord");
        if (!sharedSetting.enabled || !sharedSetting.hasToken) {
          return reply.status(409).send({
            error: "Shared Discord bot is not enabled by the platform admin"
          });
        }

        const result = await withTransaction(async (client) => {
          const existingBindingRes = await client.query<{
            id: string;
            config_json: Record<string, unknown>;
          }>(
            `SELECT id, config_json
               FROM connector_bindings
              WHERE workspace_id = $1
                AND type = 'discord'
              FOR UPDATE`,
            [params.wsId]
          );
          const existingConfig = existingBindingRes.rows[0]?.config_json;
          const existingConfigJson = existingConfig && typeof existingConfig === "object" ? existingConfig : {};

          const connectorConfig = {
            connectionMode: "shared" as const,
            botUserId: sharedSetting.botUserId,
            defaultEnvironmentId: body.defaultEnvironmentId,
            mentionOnly: true,
            mode: "shared" as const,
            agentId: normalizeConnectorAgentId(body.agentId),
            tools: normalizeConnectorToolOptionsConfig(body.tools, memoryEnabled),
            prefixEnabled: body.prefixEnabled,
            keywordEnabled: body.keywordEnabled,
            llmFallbackEnabled: body.llmFallbackEnabled,
            channelHistoryEnabled: body.channelHistoryEnabled,
            channelHistoryIncludePinnedMessages: body.channelHistoryIncludePinnedMessages,
            ...(typeof body.channelHistoryMaxChars === "number"
              ? { channelHistoryMaxChars: body.channelHistoryMaxChars }
              : {}),
            ...("gatewayStartedAt" in existingConfigJson
              ? { gatewayStartedAt: existingConfigJson.gatewayStartedAt }
              : {})
          };

          const upserted = await client.query<{ id: string }>(
            `INSERT INTO connector_bindings (workspace_id, type, status, config_json)
             VALUES ($1, 'discord', 'active', $2::jsonb)
             ON CONFLICT (workspace_id, type)
             DO UPDATE SET
               status = 'active',
               config_json = EXCLUDED.config_json,
               updated_at = now()
             RETURNING id`,
            [params.wsId, JSON.stringify(connectorConfig)]
          );

          const existingBinding = existingBindingRes.rows[0];
          if (
            existingBinding
            && hasDiscordBindingOwnerChanged(existingBinding.config_json, connectorConfig)
          ) {
            await clearDiscordConnectorRoutingState(upserted.rows[0].id, client);
          }

          return upserted.rows[0];
        });

        return reply.send({
          id: result.id,
          mode: "shared",
          bot: {
            id: sharedSetting.botUserId,
            username: null,
            globalName: null
          }
        });
      }

      const botToken = (body.botToken ?? "").trim();
      if (!botToken) {
        return reply.status(400).send({ error: "Discord bot token is required for custom mode" });
      }

      let botInfo: DiscordBotInfo | null = null;
      try {
        const getMeResponse = await callDiscordApi<DiscordBotInfo>(botToken, "/users/@me");
        if (!getMeResponse.ok || !getMeResponse.result) {
          return reply
            .status(400)
            .send({ error: getMeResponse.description ?? "Invalid Discord bot token" });
        }

        if (getMeResponse.result.bot === false) {
          return reply.status(400).send({ error: "Discord token is not a bot token" });
        }

        botInfo = getMeResponse.result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(502).send({ error: `Discord bot validation failed: ${message}` });
      }

      if (!botInfo?.id) {
        return reply.status(400).send({ error: "Discord bot validation did not return a bot id" });
      }

      const result = await withTransaction(async (client) => {
        const existingBindingRes = await client.query<{
          id: string;
          config_json: Record<string, unknown>;
        }>(
          `SELECT id, config_json
             FROM connector_bindings
            WHERE workspace_id = $1
              AND type = 'discord'
            FOR UPDATE`,
          [params.wsId]
        );
        const existingConfig = existingBindingRes.rows[0]?.config_json;
        const existingConfigJson = existingConfig && typeof existingConfig === "object" ? existingConfig : {};

        const connectorConfig = {
          connectionMode: "custom" as const,
          botToken,
          botUserId: botInfo.id,
          defaultEnvironmentId: body.defaultEnvironmentId,
          mentionOnly: true,
          mode: "gateway" as const,
          agentId: normalizeConnectorAgentId(body.agentId),
          tools: normalizeConnectorToolOptionsConfig(body.tools, memoryEnabled),
          prefixEnabled: body.prefixEnabled,
          keywordEnabled: body.keywordEnabled,
          llmFallbackEnabled: body.llmFallbackEnabled,
          channelHistoryEnabled: body.channelHistoryEnabled,
          channelHistoryIncludePinnedMessages: body.channelHistoryIncludePinnedMessages,
          ...(typeof body.channelHistoryMaxChars === "number"
            ? { channelHistoryMaxChars: body.channelHistoryMaxChars }
            : {}),
          ...("gatewayStartedAt" in existingConfigJson
            ? { gatewayStartedAt: existingConfigJson.gatewayStartedAt }
            : {})
        };

        const upserted = await client.query<{ id: string }>(
          `INSERT INTO connector_bindings (workspace_id, type, status, config_json)
           VALUES ($1, 'discord', 'active', $2::jsonb)
           ON CONFLICT (workspace_id, type)
           DO UPDATE SET
             status = 'active',
             config_json = EXCLUDED.config_json,
             updated_at = now()
           RETURNING id`,
          [params.wsId, JSON.stringify(connectorConfig)]
        );

        const existingBinding = existingBindingRes.rows[0];
        if (
          existingBinding
          && hasDiscordBindingOwnerChanged(existingBinding.config_json, connectorConfig)
        ) {
          await clearDiscordConnectorRoutingState(upserted.rows[0].id, client);
        }

        return upserted.rows[0];
      });

      return reply.send({
        id: result.id,
        mode: "gateway",
        bot: {
          id: botInfo.id,
          username: botInfo.username ?? null,
          globalName: botInfo.global_name ?? null
        }
      });
    }
  );
};
