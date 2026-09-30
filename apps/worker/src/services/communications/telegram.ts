import { query } from "../../lib/db.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 3500;

interface TelegramBinding {
  botToken?: string;
  connectionMode?: "custom" | "shared";
}

interface TelegramSentMessage {
  message_id?: number;
}

interface TelegramSendResponse {
  ok: boolean;
  description?: string;
  result?: TelegramSentMessage;
}

export interface NotificationDeliveryResult {
  status: "sent" | "skipped" | "failed";
  channel: "telegram";
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

function parseTelegramMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as { message_id?: unknown };
  if (typeof candidate.message_id !== "number" || !Number.isInteger(candidate.message_id)) {
    return null;
  }

  return String(candidate.message_id);
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

export async function sendTelegramResultIfNeeded(
  taskId: string,
  connectorContextId: string | null,
  text: string
): Promise<NotificationDeliveryResult> {
  if (!connectorContextId) {
    return {
      status: "skipped",
      channel: "telegram",
      detail: "Missing connector context."
    };
  }

  const threadRes = await query<{
    external_chat_id: string;
    external_thread_id: string | null;
    binding_id: string;
  }>(
    `SELECT ct.external_chat_id, ct.external_thread_id, ct.binding_id
       FROM connector_threads ct
       JOIN connector_bindings cb ON cb.id = ct.binding_id
      WHERE ct.id = $1
        AND cb.type = 'telegram'`,
    [connectorContextId]
  );

  if ((threadRes.rowCount ?? 0) === 0) {
    return {
      status: "skipped",
      channel: "telegram",
      detail: "No Telegram connector thread found."
    };
  }

  const thread = threadRes.rows[0];

  const bindingRes = await query<{ config_json: TelegramBinding }>(
    `SELECT config_json
       FROM connector_bindings
      WHERE id = $1
        AND type = 'telegram'`,
    [thread.binding_id]
  );

  if ((bindingRes.rowCount ?? 0) === 0) {
    return {
      status: "skipped",
      channel: "telegram",
      detail: "No Telegram binding found for thread."
    };
  }

  const bindingConfig = bindingRes.rows[0].config_json;
  const connectionMode = bindingConfig.connectionMode === "shared" ? "shared" : "custom";
  let botToken = bindingConfig.botToken;
  if (connectionMode === "shared") {
    const sharedRes = await query<{ bot_token: string | null; enabled: boolean }>(
      `SELECT bot_token, enabled
         FROM shared_connector_settings
        WHERE connector_type = 'telegram'
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
      channel: "telegram",
      detail: connectionMode === "shared" ? "Shared Telegram bot token is missing." : "Telegram bot token is missing."
    };
  }

  const chunks = splitTextIntoChunks(text, TELEGRAM_MAX_MESSAGE_LENGTH);
  let lastOutboundMessageId: string | null = null;

  try {
    for (const chunk of chunks) {
      const payload: Record<string, unknown> = {
        chat_id: thread.external_chat_id,
        text: chunk
      };

      if (thread.external_thread_id) {
        payload.message_thread_id = Number(thread.external_thread_id);
      }

      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new Error("Telegram sendMessage returned invalid JSON");
      }

      if (!parsed || typeof parsed !== "object" || !("ok" in parsed)) {
        throw new Error("Telegram sendMessage returned unexpected payload");
      }

      const telegramResponse = parsed as TelegramSendResponse;
      if (!response.ok || telegramResponse.ok !== true) {
        throw new Error(telegramResponse.description ?? `Telegram sendMessage failed with HTTP ${response.status}`);
      }

      const outboundMessageId = parseTelegramMessageId(telegramResponse.result);
      if (outboundMessageId) {
        lastOutboundMessageId = outboundMessageId;
      }
    }

    if (!lastOutboundMessageId) {
      return {
        status: "failed",
        channel: "telegram",
        detail: "Telegram accepted message without returning a message id."
      };
    }

    await upsertConnectorMessageLink({
      threadId: connectorContextId,
      externalMessageId: lastOutboundMessageId,
      taskId
    });
    return {
      status: "sent",
      channel: "telegram",
      externalMessageId: lastOutboundMessageId
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(
      `INSERT INTO task_events (task_id, type, payload_json)
       VALUES ($1, 'error', $2::jsonb)`,
      [taskId, JSON.stringify({ telegramError: message })]
    );
    return {
      status: "failed",
      channel: "telegram",
      detail: message
    };
  }
}
