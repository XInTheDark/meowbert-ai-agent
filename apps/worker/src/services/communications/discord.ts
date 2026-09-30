import { query } from "../../lib/db.js";

const DISCORD_MAX_MESSAGE_LENGTH = 1900;

interface DiscordBinding {
  botToken?: string;
  connectionMode?: "custom" | "shared";
}

interface DiscordSendResponse {
  id?: string;
  message?: string;
}

export interface NotificationDeliveryResult {
  status: "sent" | "skipped" | "failed";
  channel: "discord";
  detail?: string;
  externalMessageId?: string | null;
}

function splitTextIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt <= 0) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function normalizeDiscordSnowflake(input: unknown): string | null {
  if (typeof input !== "string" || !/^\d+$/.test(input)) {
    return null;
  }

  return input;
}

async function upsertConnectorMessageLink(input: {
  threadId: string;
  externalMessageId: string;
  taskId: string;
}): Promise<void> {
  await query(
    `INSERT INTO connector_message_links (thread_id, external_message_id, direction, task_id)
     VALUES ($1, $2, 'outbound', $3)
     ON CONFLICT (thread_id, external_message_id)
     DO UPDATE SET
       direction = EXCLUDED.direction,
       task_id = EXCLUDED.task_id`,
    [input.threadId, input.externalMessageId, input.taskId]
  );
}

export async function sendDiscordResultIfNeeded(
  taskId: string,
  connectorContextId: string | null,
  text: string
): Promise<NotificationDeliveryResult> {
  if (!connectorContextId) {
    return {
      status: "skipped",
      channel: "discord",
      detail: "Missing connector context."
    };
  }

  const threadRes = await query<{
    external_chat_id: string;
    binding_id: string;
  }>(
    `SELECT ct.external_chat_id, ct.binding_id
       FROM connector_threads ct
       JOIN connector_bindings cb ON cb.id = ct.binding_id
      WHERE ct.id = $1
        AND cb.type = 'discord'`,
    [connectorContextId]
  );

  if ((threadRes.rowCount ?? 0) === 0) {
    return {
      status: "skipped",
      channel: "discord",
      detail: "No Discord connector thread found."
    };
  }

  const thread = threadRes.rows[0];

  const bindingRes = await query<{ config_json: DiscordBinding }>(
    `SELECT config_json
       FROM connector_bindings
      WHERE id = $1
        AND type = 'discord'`,
    [thread.binding_id]
  );

  if ((bindingRes.rowCount ?? 0) === 0) {
    return {
      status: "skipped",
      channel: "discord",
      detail: "No Discord binding found for thread."
    };
  }

  const bindingConfig = bindingRes.rows[0].config_json;
  const connectionMode = bindingConfig.connectionMode === "shared" ? "shared" : "custom";
  let botToken = bindingConfig.botToken;
  if (connectionMode === "shared") {
    const sharedRes = await query<{ bot_token: string | null; enabled: boolean }>(
      `SELECT bot_token, enabled
         FROM shared_connector_settings
        WHERE connector_type = 'discord'
        LIMIT 1`
    );
    if ((sharedRes.rowCount ?? 0) > 0 && sharedRes.rows[0].enabled) {
      botToken = sharedRes.rows[0].bot_token ?? undefined;
    } else {
      botToken = undefined;
    }
  }
  if (!botToken) {
    return {
      status: "failed",
      channel: "discord",
      detail: connectionMode === "shared" ? "Shared Discord bot token is missing." : "Discord bot token is missing."
    };
  }

  const chunks = splitTextIntoChunks(text, DISCORD_MAX_MESSAGE_LENGTH);
  let lastOutboundMessageId: string | null = null;

  try {
    for (const chunk of chunks) {
      const payload = {
        content: chunk,
        allowed_mentions: {
          parse: []
        }
      };

      const response = await fetch(
        `https://discord.com/api/v10/channels/${thread.external_chat_id}/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bot ${botToken}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new Error("Discord create message returned invalid JSON");
      }

      if (!response.ok) {
        const discordResponse = parsed as DiscordSendResponse | null;
        throw new Error(
          discordResponse && typeof discordResponse.message === "string"
            ? discordResponse.message
            : `Discord create message failed with HTTP ${response.status}`
        );
      }

      const discordResponse = parsed as DiscordSendResponse;
      const outboundMessageId = normalizeDiscordSnowflake(discordResponse.id);
      if (outboundMessageId) {
        lastOutboundMessageId = outboundMessageId;
      }
    }

    if (!lastOutboundMessageId) {
      return {
        status: "failed",
        channel: "discord",
        detail: "Discord accepted message without returning a message id."
      };
    }

    await upsertConnectorMessageLink({
      threadId: connectorContextId,
      externalMessageId: lastOutboundMessageId,
      taskId
    });
    return {
      status: "sent",
      channel: "discord",
      externalMessageId: lastOutboundMessageId
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(
      `INSERT INTO task_events (task_id, type, payload_json)
       VALUES ($1, 'error', $2::jsonb)`,
      [taskId, JSON.stringify({ discordError: message })]
    );
    return {
      status: "failed",
      channel: "discord",
      detail: message
    };
  }
}
