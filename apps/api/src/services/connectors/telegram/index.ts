import fs from "node:fs";
import path from "node:path";
import { ensureSandboxWritablePath } from "@meowbert/shared";
import { query } from "../../../lib/db.js";
import { resolveTaskInputsDirForEnvironment } from "../../storage/environment-paths.js";
import { normalizeConnectorAgentId } from "../connector-agent.js";
import { describeConnectorExecutionError } from "../connector-execution-errors.js";
import {
  deliverConnectorMessageToMaster,
  resolveConnectorMasterTarget,
  type ConnectorIngestResult
} from "../connector-master-ingest.js";
import { getOrCreateConnectorThread } from "../connector-threads.js";
import {
  consumeConnectorPairCodeIfPresent,
  resolveConnectorPairedUserId
} from "../connector-pairing.js";
import { buildConnectorMessageWithAttachments } from "../connector-message-formatting.js";

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    date?: number;
    from?: {
      id?: number;
      is_bot?: boolean;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    message_thread_id?: number;
    reply_to_message?: {
      message_id?: number;
      text?: string;
      caption?: string;
    };
    chat: {
      id: number;
      type?: string;
      title?: string;
      username?: string;
    };
    photo?: Array<{
      file_id: string;
      file_size?: number;
      width?: number;
      height?: number;
    }>;
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
  };
}

export interface TelegramBindingRow {
  id: string;
  workspace_id: string;
  config_json: Record<string, unknown>;
  status: string;
}

interface TelegramBindingConfig {
  botToken: string | null;
  defaultEnvironmentId: string | null;
  agentId: string | null;
  tools: unknown;
}

export type TelegramUpdateProcessResult = ConnectorIngestResult;

function normalizeBindingConfig(configJson: Record<string, unknown>): TelegramBindingConfig {
  const botToken =
    typeof configJson.botToken === "string" && configJson.botToken.trim().length > 0
      ? configJson.botToken.trim()
      : null;

  const defaultEnvironmentId =
    typeof configJson.defaultEnvironmentId === "string" &&
    configJson.defaultEnvironmentId.trim().length > 0
      ? configJson.defaultEnvironmentId.trim()
      : null;

  return {
    botToken,
    defaultEnvironmentId,
    agentId: normalizeConnectorAgentId(configJson.agentId),
    tools: configJson.tools
  };
}

async function resolveTelegramFileUrl(botToken: string, fileId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { ok?: boolean; result?: { file_path?: string } };
    if (!data.ok || typeof data.result?.file_path !== "string") {
      return null;
    }

    return `https://api.telegram.org/file/bot${botToken}/${data.result.file_path}`;
  } catch {
    return null;
  }
}

async function downloadTelegramAttachments(input: {
  botToken: string;
  message: NonNullable<TelegramUpdate["message"]>;
  workspaceId: string;
  environmentId: string;
  taskId: string;
}): Promise<string[]> {
  const inputsDir = await resolveTaskInputsDirForEnvironment({
    environmentId: input.environmentId,
    taskId: input.taskId
  });
  const environmentRoot = path.resolve(inputsDir, "..", "..", "..", "..");
  const savedPaths: string[] = [];

  interface FileEntry {
    fileId: string;
    fileName: string;
  }

  const filesToDownload: FileEntry[] = [];

  if (input.message.photo && input.message.photo.length > 0) {
    const largest = input.message.photo.reduce((best, current) =>
      (current.file_size ?? 0) >= (best.file_size ?? 0) ? current : best
    );
    filesToDownload.push({ fileId: largest.file_id, fileName: `photo_${largest.file_id}.jpg` });
  }

  if (input.message.document) {
    const doc = input.message.document;
    const ext = doc.file_name ? path.extname(doc.file_name) : "";
    filesToDownload.push({
      fileId: doc.file_id,
      fileName: doc.file_name ?? `document_${doc.file_id}${ext}`
    });
  }

  if (filesToDownload.length === 0) {
    return [];
  }

  fs.mkdirSync(inputsDir, { recursive: true });
  await ensureSandboxWritablePath({
    rootPath: environmentRoot,
    targetPath: inputsDir
  });

  for (const entry of filesToDownload) {
    const downloadUrl = await resolveTelegramFileUrl(input.botToken, entry.fileId);
    if (!downloadUrl) {
      continue;
    }

    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const safeName = path.basename(entry.fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
      const dest = path.join(inputsDir, safeName);
      fs.writeFileSync(dest, buffer);
      await ensureSandboxWritablePath({
        rootPath: environmentRoot,
        targetPath: dest
      });
      savedPaths.push(dest);
    } catch {
      // Best effort; skip failed downloads.
    }
  }

  return savedPaths;
}

function normalizeTelegramTimestamp(epochSeconds: unknown): string | null {
  if (typeof epochSeconds !== "number" || !Number.isInteger(epochSeconds) || epochSeconds <= 0) {
    return null;
  }

  const parsed = new Date(epochSeconds * 1000);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function buildTelegramUserLabel(message: NonNullable<TelegramUpdate["message"]>): string {
  const from = message.from;
  const userId = typeof from?.id === "number" && Number.isInteger(from.id) ? String(from.id) : "unknown";
  const username =
    typeof from?.username === "string" && from.username.trim().length > 0
      ? `@${from.username.trim()}`
      : null;
  const fullName = [from?.first_name, from?.last_name]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim())
    .join(" ");

  if (username && fullName) {
    return `${username} (${fullName}, id:${userId})`;
  }

  if (username) {
    return `${username} (id:${userId})`;
  }

  if (fullName) {
    return `${fullName} (id:${userId})`;
  }

  return `id:${userId}`;
}

function buildTelegramChannelLabel(input: {
  message: NonNullable<TelegramUpdate["message"]>;
  chatId: string;
  threadId: string;
}): string {
  const typeRaw =
    typeof input.message.chat.type === "string" && input.message.chat.type.trim().length > 0
      ? input.message.chat.type.trim().toLowerCase()
      : "chat";

  if (typeRaw === "private") {
    return `dm:${input.chatId}`;
  }

  const title =
    typeof input.message.chat.title === "string" && input.message.chat.title.trim().length > 0
      ? input.message.chat.title.trim()
      : typeof input.message.chat.username === "string" && input.message.chat.username.trim().length > 0
        ? `@${input.message.chat.username.trim()}`
        : null;

  const base = title ? `${typeRaw}:${input.chatId} (${title})` : `${typeRaw}:${input.chatId}`;
  return input.threadId ? `${base} thread:${input.threadId}` : base;
}

function buildTelegramReplyContext(message: NonNullable<TelegramUpdate["message"]>): string | null {
  const replied = message.reply_to_message;
  const text = (replied?.text ?? replied?.caption ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return null;
  }

  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function buildTelegramMessageWithMetadata(input: {
  rawText: string;
  message: NonNullable<TelegramUpdate["message"]>;
  chatId: string;
  threadId: string;
}): string {
  const body = input.rawText.trim().length > 0 ? input.rawText.trim() : "[No text content]";
  const userLabel = buildTelegramUserLabel(input.message);
  const receivedAt = normalizeTelegramTimestamp(input.message.date) ?? new Date().toISOString();
  const channelLabel = buildTelegramChannelLabel({
    message: input.message,
    chatId: input.chatId,
    threadId: input.threadId
  });

  const replyContext = buildTelegramReplyContext(input.message);

  return [
    "Connector metadata:",
    "- Source: Telegram",
    `- User: ${userLabel}`,
    `- Time: ${receivedAt}`,
    `- Channel: ${channelLabel}`,
    ...(replyContext ? [`- In reply to: "${replyContext}"`] : []),
    "",
    "Message:",
    body
  ].join("\n");
}

async function sendTelegramTextMessage(input: {
  botToken: string | null;
  chatId: string;
  threadId: string;
  text: string;
}): Promise<void> {
  if (!input.botToken) {
    return;
  }

  const payload: Record<string, unknown> = {
    chat_id: input.chatId,
    text: input.text
  };

  if (input.threadId) {
    payload.message_thread_id = Number(input.threadId);
  }

  await fetch(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  }).catch(() => {
    // Best effort only; task processing should continue even if notice send fails.
  });
}

async function maybeHandleTelegramExecutionError(input: {
  error: unknown;
  botToken: string | null;
  chatId: string;
  threadId: string;
}): Promise<boolean> {
  const message = describeConnectorExecutionError(input.error);
  if (!message) {
    return false;
  }

  await sendTelegramTextMessage({
    botToken: input.botToken,
    chatId: input.chatId,
    threadId: input.threadId,
    text: message
  });
  return true;
}

export async function getTelegramBindingById(bindingId: string): Promise<TelegramBindingRow | null> {
  const bindingRes = await query<TelegramBindingRow>(
    `SELECT id, workspace_id, config_json, status
       FROM connector_bindings
      WHERE id = $1
        AND type = 'telegram'`,
    [bindingId]
  );

  if ((bindingRes.rowCount ?? 0) === 0) {
    return null;
  }

  return bindingRes.rows[0];
}

export async function processAuthorizedTelegramMessageForBinding(input: {
  binding: TelegramBindingRow;
  message: NonNullable<TelegramUpdate["message"]>;
  rawText: string;
  chatId: string;
  threadId: string;
  inboundMessageId: string | null;
  actorUserId?: string | null;
  botTokenOverride?: string | null;
}): Promise<TelegramUpdateProcessResult> {
  const binding = input.binding;
  const parsedBindingConfig = normalizeBindingConfig(binding.config_json);
  const bindingConfig: TelegramBindingConfig = {
    ...parsedBindingConfig,
    botToken: input.botTokenOverride ?? parsedBindingConfig.botToken
  };

  const thread = await getOrCreateConnectorThread({
    bindingId: binding.id,
    workspaceId: binding.workspace_id,
    externalChatId: input.chatId,
    externalThreadId: input.threadId
  });

  try {
    const target = await resolveConnectorMasterTarget({
      source: "telegram",
      workspaceId: binding.workspace_id,
      actorUserId: input.actorUserId,
      defaultEnvironmentId: bindingConfig.defaultEnvironmentId,
      routingText: input.rawText || "(attachment)"
    });
    const filePaths = bindingConfig.botToken
      ? await downloadTelegramAttachments({
          botToken: bindingConfig.botToken,
          message: input.message,
          workspaceId: binding.workspace_id,
          environmentId: target.environmentId,
          taskId: target.masterTaskId
        })
      : [];
    const message = buildConnectorMessageWithAttachments(
      buildTelegramMessageWithMetadata({
        rawText: input.rawText,
        message: input.message,
        chatId: input.chatId,
        threadId: input.threadId
      }),
      filePaths
    );

    return await deliverConnectorMessageToMaster({
      target,
      threadId: thread.id,
      inboundMessageId: input.inboundMessageId,
      message,
      toolsConfig: bindingConfig.tools,
      agentId: bindingConfig.agentId
    });
  } catch (error) {
    if (await maybeHandleTelegramExecutionError({
      error,
      botToken: bindingConfig.botToken,
      chatId: input.chatId,
      threadId: input.threadId
    })) {
      return { processed: false };
    }
    throw error;
  }
}

export async function processTelegramUpdateForBinding(
  binding: TelegramBindingRow,
  update: TelegramUpdate
): Promise<TelegramUpdateProcessResult> {
  const rawText = (update.message?.text ?? update.message?.caption ?? "").trim();
  const chatIdRaw = update.message?.chat.id;
  const messageIdRaw = update.message?.message_id;
  const senderUserIdRaw = update.message?.from?.id;
  const isSenderBot = update.message?.from?.is_bot === true;
  const hasAttachments = !!(update.message?.photo?.length || update.message?.document);

  if ((!rawText && !hasAttachments) || !chatIdRaw || typeof senderUserIdRaw !== "number" || !Number.isInteger(senderUserIdRaw) || isSenderBot) {
    return { processed: false };
  }

  const chatId = String(chatIdRaw);
  const threadId = String(update.message?.message_thread_id ?? "");
  const senderUserId = String(senderUserIdRaw);
  const inboundMessageId =
    typeof messageIdRaw === "number" && Number.isInteger(messageIdRaw)
      ? String(messageIdRaw)
      : null;
  const bindingConfig = normalizeBindingConfig(binding.config_json);
  if (binding.config_json.connectionMode === "shared") {
    return { processed: false };
  }

  if (rawText) {
    const pairingAttempt = await consumeConnectorPairCodeIfPresent({
      bindingId: binding.id,
      workspaceId: binding.workspace_id,
      externalUserId: senderUserId,
      messageText: rawText
    });

    if (pairingAttempt.handled) {
      if (pairingAttempt.outcome === "paired") {
        await sendTelegramTextMessage({
          botToken: bindingConfig.botToken,
          chatId,
          threadId,
          text: "Pairing complete. You're now authorized to send tasks from this Telegram account."
        });
      } else if (pairingAttempt.outcome === "expired") {
        await sendTelegramTextMessage({
          botToken: bindingConfig.botToken,
          chatId,
          threadId,
          text: "That pairing code expired. Generate a new one from the Connectors page."
        });
      } else if (pairingAttempt.outcome === "already_used") {
        await sendTelegramTextMessage({
          botToken: bindingConfig.botToken,
          chatId,
          threadId,
          text: "That pairing code was already used. Generate a new one if needed."
        });
      } else if (pairingAttempt.outcome === "already_linked") {
        await sendTelegramTextMessage({
          botToken: bindingConfig.botToken,
          chatId,
          threadId,
          text: "That Telegram account is already paired with another workspace user."
        });
      } else if (pairingAttempt.outcome === "invalid") {
        await sendTelegramTextMessage({
          botToken: bindingConfig.botToken,
          chatId,
          threadId,
          text: "Pairing code not recognized. Generate a fresh code from the Connectors page."
        });
      }

      return { processed: false };
    }
  }

  const actorUserId = await resolveConnectorPairedUserId({
    bindingId: binding.id,
    externalUserId: senderUserId
  });

  if (!actorUserId) {
    return { processed: false };
  }

  return processAuthorizedTelegramMessageForBinding({
    binding,
    message: update.message!,
    rawText,
    chatId,
    threadId,
    inboundMessageId,
    actorUserId
  });
}
