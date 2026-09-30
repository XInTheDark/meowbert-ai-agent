import fs from "node:fs";
import path from "node:path";
import { ensureSandboxWritablePath } from "@meowbert/shared";
import { query } from "../../../lib/db.js";
import { resolveTaskInputsDirForEnvironment } from "../../storage/environment-paths.js";
import {
  shouldRejectDiscordInboundForBinding,
  type DiscordConnectionMode
} from "./discord-binding-state.js";
import { normalizeConnectorAgentId } from "../connector-agent.js";
import { describeConnectorExecutionError } from "../connector-execution-errors.js";
import { resolveContextWindowTokensForWorkspace } from "../../platform/platform-model-metadata.js";
import {
  deliverConnectorMessageToMaster,
  resolveConnectorMasterTarget,
  type ConnectorIngestResult
} from "../connector-master-ingest.js";
import {
  connectorThreadHasInboundMessages,
  findConnectorThread,
  getOrCreateConnectorThread,
  isConnectorThreadMidConversation
} from "../connector-threads.js";
import {
  consumeConnectorPairCodeIfPresent,
  resolveConnectorPairedUserId
} from "../connector-pairing.js";
import { buildConnectorMessageWithAttachments } from "../connector-message-formatting.js";

export interface DiscordMessage {
  id?: string;
  channel_id?: string;
  guild_id?: string;
  timestamp?: string;
  content?: string;
  author?: {
    id?: string;
    username?: string;
    global_name?: string | null;
    bot?: boolean;
  };
  mentions?: Array<{ id?: string }>;
  message_reference?: {
    message_id?: string;
  };
  referenced_message?: {
    content?: string;
  };
  attachments?: Array<{
    url?: string;
    filename?: string;
    content_type?: string;
  }>;
}

export interface DiscordBindingRow {
  id: string;
  workspace_id: string;
  config_json: Record<string, unknown>;
  status: string;
}

interface DiscordBindingConfig {
  botToken: string | null;
  botUserId: string | null;
  defaultEnvironmentId: string | null;
  agentId: string | null;
  tools: unknown;
  mentionOnly: boolean;
  channelHistoryEnabled: boolean;
  channelHistoryMaxChars: number | null;
  channelHistoryIncludePinnedMessages: boolean;
}

interface DiscordInboundMetadata {
  authorId: string;
  authorDisplayName: string | null;
  guildId: string | null;
  receivedAt: string | null;
}

export type DiscordMessageProcessResult = ConnectorIngestResult;

interface DiscordApiChannelMessage {
  id?: string;
  content?: string;
  timestamp?: string;
  author?: {
    id?: string;
    username?: string;
    global_name?: string | null;
    bot?: boolean;
  };
  attachments?: Array<{
    filename?: string;
  }>;
}

const DEFAULT_CONTEXT_HISTORY_RATIO = 0.2;
const APPROX_CHARS_PER_TOKEN = 4;
const MIN_CHANNEL_HISTORY_CHARS = 1_000;
const MAX_CHANNEL_HISTORY_CHARS = 500_000;
const RECENT_CHANNEL_HISTORY_MESSAGE_LIMIT = 100;
const DISCORD_CONTEXT_SECTION_HEADING = "Additional channel context:";

function normalizeDiscordSnowflake(input: unknown): string | null {
  if (typeof input !== "string" || !/^\d+$/.test(input)) {
    return null;
  }

  return input;
}

function normalizeIsoTimestamp(input: unknown): string | null {
  if (typeof input !== "string" || input.trim().length === 0) {
    return null;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function resolveDiscordAuthorDisplayName(author: DiscordMessage["author"]): string | null {
  if (!author) {
    return null;
  }

  if (typeof author.global_name === "string" && author.global_name.trim().length > 0) {
    return author.global_name.trim();
  }

  if (typeof author.username === "string" && author.username.trim().length > 0) {
    return author.username.trim();
  }

  return null;
}

function normalizeDiscordBindingConfig(configJson: Record<string, unknown>): DiscordBindingConfig {
  const botToken =
    typeof configJson.botToken === "string" && configJson.botToken.trim().length > 0
      ? configJson.botToken.trim()
      : null;

  const botUserId = normalizeDiscordSnowflake(configJson.botUserId);

  const defaultEnvironmentId =
    typeof configJson.defaultEnvironmentId === "string" &&
    configJson.defaultEnvironmentId.trim().length > 0
      ? configJson.defaultEnvironmentId.trim()
      : null;

  const mentionOnly = configJson.mentionOnly !== false;
  const channelHistoryEnabled = configJson.channelHistoryEnabled === true;
  const channelHistoryMaxCharsRaw = configJson.channelHistoryMaxChars;
  const channelHistoryMaxChars =
    typeof channelHistoryMaxCharsRaw === "number" &&
    Number.isFinite(channelHistoryMaxCharsRaw) &&
    channelHistoryMaxCharsRaw > 0
      ? Math.floor(channelHistoryMaxCharsRaw)
      : null;
  const channelHistoryIncludePinnedMessages = configJson.channelHistoryIncludePinnedMessages !== false;

  return {
    botToken,
    botUserId,
    defaultEnvironmentId,
    agentId: normalizeConnectorAgentId(configJson.agentId),
    tools: configJson.tools,
    mentionOnly,
    channelHistoryEnabled,
    channelHistoryMaxChars,
    channelHistoryIncludePinnedMessages
  };
}

function messageMentionsBot(message: DiscordMessage, botUserId: string): boolean {
  if (!Array.isArray(message.mentions)) {
    return false;
  }

  return message.mentions.some((mention) => normalizeDiscordSnowflake(mention?.id) === botUserId);
}

function normalizeInboundMessageText(rawText: string, botUserId: string | null): string {
  if (!botUserId) {
    return rawText.trim();
  }

  return rawText
    .replace(new RegExp(`<@!?${botUserId}>`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}


async function downloadAttachmentsToInputsDir(input: {
  attachments: DiscordMessage["attachments"];
  workspaceId: string;
  environmentId: string;
  taskId: string;
}): Promise<string[]> {
  const eligible = (input.attachments ?? []).filter(
    (a): a is { url: string; filename: string; content_type?: string } =>
      typeof a.url === "string" && typeof a.filename === "string"
  );

  if (eligible.length === 0) {
    return [];
  }

  const inputsDir = await resolveTaskInputsDirForEnvironment({
    environmentId: input.environmentId,
    taskId: input.taskId
  });
  const environmentRoot = path.resolve(inputsDir, "..", "..", "..", "..");
  fs.mkdirSync(inputsDir, { recursive: true });
  await ensureSandboxWritablePath({
    rootPath: environmentRoot,
    targetPath: inputsDir
  });

  const savedPaths: string[] = [];

  for (const attachment of eligible) {
    try {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const safeName = path.basename(attachment.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
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

function buildDiscordMessageWithMetadata(input: {
  text: string;
  channelId: string;
  replyToText: string | null;
  metadata?: DiscordInboundMetadata;
}): string {
  const body = input.text.trim().length > 0 ? input.text.trim() : "[No text content]";
  const authorId = input.metadata?.authorId ?? "unknown";
  const displayName = input.metadata?.authorDisplayName;
  const userLabel = displayName ? `${displayName} (id:${authorId})` : `id:${authorId}`;
  const receivedAt = input.metadata?.receivedAt ?? new Date().toISOString();
  const channelLabel =
    input.metadata?.guildId && input.metadata.guildId.length > 0
      ? `guild:${input.metadata.guildId} channel:${input.channelId}`
      : `dm:${input.channelId}`;
  const replyText = (input.replyToText ?? "").replace(/\s+/g, " ").trim();
  const replyContext = replyText.length > 500 ? `${replyText.slice(0, 500)}...` : replyText;

  return [
    "Connector metadata:",
    "- Source: Discord",
    `- User: ${userLabel}`,
    `- Time: ${receivedAt}`,
    `- Channel: ${channelLabel}`,
    ...(replyContext ? [`- In reply to: "${replyContext}"`] : []),
    "",
    "Message:",
    body
  ].join("\n");
}

function clampChannelHistoryChars(value: number): number {
  return Math.min(MAX_CHANNEL_HISTORY_CHARS, Math.max(MIN_CHANNEL_HISTORY_CHARS, Math.floor(value)));
}

function resolveChannelHistoryCharBudget(input: {
  maxContextWindowTokens: number;
  configuredMaxChars: number | null;
}): number {
  if (typeof input.configuredMaxChars === "number" && Number.isFinite(input.configuredMaxChars) && input.configuredMaxChars > 0) {
    return clampChannelHistoryChars(input.configuredMaxChars);
  }

  const derived = input.maxContextWindowTokens * DEFAULT_CONTEXT_HISTORY_RATIO * APPROX_CHARS_PER_TOKEN;
  return clampChannelHistoryChars(derived);
}

async function fetchDiscordApiList<T>(
  botToken: string,
  pathWithQuery: string
): Promise<T[] | null> {
  const response = await fetch(`https://discord.com/api/v10${pathWithQuery}`, {
    method: "GET",
    headers: {
      authorization: `Bot ${botToken}`
    }
  }).catch(() => null);

  if (!response || !response.ok) {
    return null;
  }

  const parsed = await response.json().catch(() => null);
  return Array.isArray(parsed) ? (parsed as T[]) : null;
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateWithEllipsis(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) {
    return text;
  }

  if (maxChars === 1) {
    return "…";
  }

  return `${text.slice(0, maxChars - 1)}…`;
}

function normalizeHistoryTimestamp(rawTimestamp: string | undefined): string {
  if (!rawTimestamp) {
    return "unknown-time";
  }

  const parsed = new Date(rawTimestamp);
  return Number.isNaN(parsed.getTime()) ? rawTimestamp : parsed.toISOString();
}

function formatDiscordHistoryEntry(message: DiscordApiChannelMessage): string | null {
  const messageId = normalizeDiscordSnowflake(message.id);
  if (!messageId) {
    return null;
  }

  const author = message.author;
  const authorLabel =
    compactWhitespace(
      [
        typeof author?.global_name === "string" ? author.global_name : null,
        typeof author?.username === "string" ? author.username : null,
        normalizeDiscordSnowflake(author?.id)
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)[0] ?? "unknown-user"
    );

  const content = typeof message.content === "string" ? compactWhitespace(message.content) : "";
  const attachmentNames = Array.isArray(message.attachments)
    ? message.attachments
        .map((attachment) => (typeof attachment?.filename === "string" ? compactWhitespace(attachment.filename) : ""))
        .filter((name) => name.length > 0)
    : [];

  let bodyText = content;
  if (attachmentNames.length > 0) {
    const attachmentSuffix = `[attachments: ${attachmentNames.join(", ")}]`;
    bodyText = bodyText ? `${bodyText} ${attachmentSuffix}` : attachmentSuffix;
  }
  if (!bodyText) {
    bodyText = "[empty message]";
  }

  const normalizedMessageBody = truncateWithEllipsis(bodyText, 700);
  const timestamp = normalizeHistoryTimestamp(message.timestamp);

  return `[${timestamp}] ${authorLabel}: ${normalizedMessageBody}`;
}

function buildChannelHistoryContext(input: {
  pinnedEntries: string[];
  recentEntries: string[];
  maxChars: number;
}): string | null {
  const sections: string[] = [];
  let usedChars = 0;

  function appendLine(line: string, allowTruncate = false): boolean {
    const separatorChars = sections.length === 0 ? 0 : 1;
    const remaining = input.maxChars - usedChars - separatorChars;
    if (remaining <= 0) {
      return false;
    }

    if (line.length <= remaining) {
      sections.push(line);
      usedChars += separatorChars + line.length;
      return true;
    }

    if (!allowTruncate || remaining < 12) {
      return false;
    }

    sections.push(truncateWithEllipsis(line, remaining));
    usedChars = input.maxChars;
    return false;
  }

  if (input.pinnedEntries.length > 0) {
    appendLine("Pinned Discord messages (priority context):", true);
    for (const entry of input.pinnedEntries) {
      if (!appendLine(entry, true)) {
        break;
      }
    }
  }

  if (input.recentEntries.length > 0 && usedChars < input.maxChars) {
    if (sections.length > 0) {
      appendLine("", false);
    }
    appendLine("Recent Discord channel history:", true);
    for (const entry of input.recentEntries) {
      if (!appendLine(entry, true)) {
        break;
      }
    }
  }

  if (sections.length === 0) {
    return null;
  }

  return sections.join("\n");
}

async function maybeBuildDiscordChannelHistory(input: {
  workspaceId: string;
  bindingConfig: DiscordBindingConfig;
  channelId: string;
  inboundMessageId: string | null;
}): Promise<string | null> {
  if (!input.bindingConfig.channelHistoryEnabled || !input.bindingConfig.botToken) {
    return null;
  }

  const maxContextWindowTokens = await resolveContextWindowTokensForWorkspace(input.workspaceId);
  const maxChars = resolveChannelHistoryCharBudget({
    maxContextWindowTokens,
    configuredMaxChars: input.bindingConfig.channelHistoryMaxChars
  });

  const recentPath = new URLSearchParams({
    limit: String(RECENT_CHANNEL_HISTORY_MESSAGE_LIMIT)
  });
  if (input.inboundMessageId) {
    recentPath.set("before", input.inboundMessageId);
  }

  const [recentMessages, pinnedMessagesRaw] = await Promise.all([
    fetchDiscordApiList<DiscordApiChannelMessage>(
      input.bindingConfig.botToken,
      `/channels/${encodeURIComponent(input.channelId)}/messages?${recentPath.toString()}`
    ),
    input.bindingConfig.channelHistoryIncludePinnedMessages
      ? fetchDiscordApiList<DiscordApiChannelMessage>(
          input.bindingConfig.botToken,
          `/channels/${encodeURIComponent(input.channelId)}/pins`
        )
      : Promise.resolve(null)
  ]);

  if (!recentMessages && !pinnedMessagesRaw) {
    return null;
  }

  const pinnedMessages = (pinnedMessagesRaw ?? [])
    .filter((message) => normalizeDiscordSnowflake(message.id))
    .sort((left, right) => {
      const leftTs = Date.parse(left.timestamp ?? "");
      const rightTs = Date.parse(right.timestamp ?? "");
      return (Number.isNaN(leftTs) ? 0 : leftTs) - (Number.isNaN(rightTs) ? 0 : rightTs);
    });
  const pinnedMessageIdSet = new Set(
    pinnedMessages
      .map((message) => normalizeDiscordSnowflake(message.id))
      .filter((messageId): messageId is string => typeof messageId === "string")
  );

  const pinnedEntries = pinnedMessages
    .map((message) => formatDiscordHistoryEntry(message))
    .filter((entry): entry is string => typeof entry === "string");

  const recentEntries = [...(recentMessages ?? [])]
    .filter((message) => {
      const messageId = normalizeDiscordSnowflake(message.id);
      if (!messageId) {
        return false;
      }
      if (messageId === input.inboundMessageId) {
        return false;
      }
      if (pinnedMessageIdSet.has(messageId)) {
        return false;
      }
      return true;
    })
    .reverse()
    .map((message) => formatDiscordHistoryEntry(message))
    .filter((entry): entry is string => typeof entry === "string");

  return buildChannelHistoryContext({
    pinnedEntries,
    recentEntries,
    maxChars
  });
}

function injectChannelHistoryIntoMessage(messageText: string, channelHistory: string | null): string {
  if (!channelHistory) {
    return messageText;
  }

  const currentMessage = messageText.trim().length > 0 ? messageText : "[no message body]";
  return [
    "Current Discord message:",
    currentMessage,
    "",
    DISCORD_CONTEXT_SECTION_HEADING,
    channelHistory
  ].join("\n");
}

async function sendDiscordTextMessage(input: {
  botToken: string | null;
  channelId: string;
  text: string;
}): Promise<void> {
  if (!input.botToken || !input.text.trim()) {
    return;
  }

  await fetch(`https://discord.com/api/v10/channels/${input.channelId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bot ${input.botToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      content: input.text.slice(0, 1900),
      allowed_mentions: {
        parse: []
      }
    })
  }).catch(() => {
    // Best effort only; inbound processing should continue.
  });
}

async function maybeHandleDiscordExecutionError(input: {
  error: unknown;
  botToken: string | null;
  channelId: string;
}): Promise<boolean> {
  const message = describeConnectorExecutionError(input.error);
  if (!message) {
    return false;
  }

  await sendDiscordTextMessage({
    botToken: input.botToken,
    channelId: input.channelId,
    text: message
  });
  return true;
}

export async function getDiscordBindingById(bindingId: string): Promise<DiscordBindingRow | null> {
  const bindingRes = await query<DiscordBindingRow>(
    `SELECT id, workspace_id, config_json, status
       FROM connector_bindings
      WHERE id = $1
        AND type = 'discord'`,
    [bindingId]
  );

  if ((bindingRes.rowCount ?? 0) === 0) {
    return null;
  }

  return bindingRes.rows[0];
}

export async function processAuthorizedDiscordMessageForBinding(input: {
  binding: DiscordBindingRow;
  inboundMessageId: string;
  channelId: string;
  replyToText: string | null;
  text: string;
  attachments: DiscordMessage["attachments"];
  actorUserId?: string | null;
  botTokenOverride?: string | null;
  expectedConnectionMode?: DiscordConnectionMode;
  receivedByBotUserId?: string | null;
  messageMetadata?: DiscordInboundMetadata;
}): Promise<DiscordMessageProcessResult> {
  const binding = input.binding;
  if (
    shouldRejectDiscordInboundForBinding({
      bindingConfigJson: binding.config_json,
      expectedConnectionMode: input.expectedConnectionMode,
      receivedByBotUserId: input.receivedByBotUserId
    })
  ) {
    return { processed: false };
  }

  const parsedBindingConfig = normalizeDiscordBindingConfig(binding.config_json);
  const bindingConfig: DiscordBindingConfig = {
    ...parsedBindingConfig,
    botToken: input.botTokenOverride ?? parsedBindingConfig.botToken
  };

  const thread = await getOrCreateConnectorThread({
    bindingId: binding.id,
    workspaceId: binding.workspace_id,
    externalChatId: input.channelId,
    externalThreadId: ""
  });

  try {
    const target = await resolveConnectorMasterTarget({
      source: "discord",
      workspaceId: binding.workspace_id,
      actorUserId: input.actorUserId,
      defaultEnvironmentId: bindingConfig.defaultEnvironmentId,
      routingText: input.text || "(attachment)"
    });
    const filePaths = await downloadAttachmentsToInputsDir({
      attachments: input.attachments,
      workspaceId: binding.workspace_id,
      environmentId: target.environmentId,
      taskId: target.masterTaskId
    });
    const messageWithAttachments = buildConnectorMessageWithAttachments(
      buildDiscordMessageWithMetadata({
        text: input.text,
        channelId: input.channelId,
        replyToText: input.replyToText,
        metadata: input.messageMetadata
      }),
      filePaths
    );
    const channelHistory = (await connectorThreadHasInboundMessages(thread.id))
      ? null
      : await maybeBuildDiscordChannelHistory({
          workspaceId: binding.workspace_id,
          bindingConfig,
          channelId: input.channelId,
          inboundMessageId: input.inboundMessageId
        });

    return await deliverConnectorMessageToMaster({
      target,
      threadId: thread.id,
      inboundMessageId: input.inboundMessageId,
      message: injectChannelHistoryIntoMessage(messageWithAttachments, channelHistory),
      toolsConfig: bindingConfig.tools,
      agentId: bindingConfig.agentId
    });
  } catch (error) {
    if (await maybeHandleDiscordExecutionError({
      error,
      botToken: bindingConfig.botToken,
      channelId: input.channelId
    })) {
      return { processed: false };
    }
    throw error;
  }
}

export async function processDiscordMessageForBinding(
  binding: DiscordBindingRow,
  message: DiscordMessage,
  options?: {
    receivedByBotUserId?: string | null;
  }
): Promise<DiscordMessageProcessResult> {
  const inboundMessageId = normalizeDiscordSnowflake(message.id);
  const channelId = normalizeDiscordSnowflake(message.channel_id);
  const authorId = normalizeDiscordSnowflake(message.author?.id);
  const rawText = typeof message.content === "string" ? message.content : "";
  const isBotMessage = message.author?.bot === true;
  const hasAttachments =
    Array.isArray(message.attachments) &&
    message.attachments.some((a) => typeof a.url === "string" && typeof a.filename === "string");

  if (!inboundMessageId || !channelId || !authorId || isBotMessage) {
    return { processed: false };
  }

  const bindingConfig = normalizeDiscordBindingConfig(binding.config_json);
  if (binding.config_json.connectionMode === "shared") {
    return { processed: false };
  }

  if (bindingConfig.botUserId && authorId === bindingConfig.botUserId) {
    return { processed: false };
  }

  const isDirectMessage = typeof message.guild_id !== "string" || message.guild_id.length === 0;
  const existingThread = !isDirectMessage && bindingConfig.mentionOnly && bindingConfig.botUserId
    ? await findConnectorThread({
        bindingId: binding.id,
        externalChatId: channelId,
        externalThreadId: ""
      })
    : null;
  const isMidConversation = existingThread
    ? await isConnectorThreadMidConversation(existingThread.id)
    : false;
  if (!isDirectMessage && bindingConfig.mentionOnly && bindingConfig.botUserId) {
    if (!isMidConversation && !messageMentionsBot(message, bindingConfig.botUserId)) {
      return { processed: false };
    }
  }

  const text = normalizeInboundMessageText(rawText, bindingConfig.botUserId);
  if (!text && !hasAttachments) {
    return { processed: false };
  }

  if (text) {
    const pairingAttempt = await consumeConnectorPairCodeIfPresent({
      bindingId: binding.id,
      workspaceId: binding.workspace_id,
      externalUserId: authorId,
      messageText: text
    });

    if (pairingAttempt.handled) {
      if (pairingAttempt.outcome === "paired") {
        await sendDiscordTextMessage({
          botToken: bindingConfig.botToken,
          channelId,
          text: "Pairing complete. You're now authorized to send tasks from this Discord account."
        });
      } else if (pairingAttempt.outcome === "expired") {
        await sendDiscordTextMessage({
          botToken: bindingConfig.botToken,
          channelId,
          text: "That pairing code expired. Generate a new one from the Connectors page."
        });
      } else if (pairingAttempt.outcome === "already_used") {
        await sendDiscordTextMessage({
          botToken: bindingConfig.botToken,
          channelId,
          text: "That pairing code was already used. Generate a new one if needed."
        });
      } else if (pairingAttempt.outcome === "already_linked") {
        await sendDiscordTextMessage({
          botToken: bindingConfig.botToken,
          channelId,
          text: "This Discord account is already paired with another workspace user."
        });
      } else if (pairingAttempt.outcome === "invalid") {
        await sendDiscordTextMessage({
          botToken: bindingConfig.botToken,
          channelId,
          text: "Pairing code not recognized. Generate a fresh code from the Connectors page."
        });
      }

      return { processed: false };
    }
  }

  const actorUserId = await resolveConnectorPairedUserId({
    bindingId: binding.id,
    externalUserId: authorId
  });
  if (!actorUserId) {
    return { processed: false };
  }

  return processAuthorizedDiscordMessageForBinding({
    binding,
    inboundMessageId,
    channelId,
    replyToText: typeof message.referenced_message?.content === "string" ? message.referenced_message.content : null,
    text,
    attachments: message.attachments,
    actorUserId,
    expectedConnectionMode: "custom",
    receivedByBotUserId: options?.receivedByBotUserId,
    messageMetadata: {
      authorId,
      authorDisplayName: resolveDiscordAuthorDisplayName(message.author),
      guildId: normalizeDiscordSnowflake(message.guild_id),
      receivedAt: normalizeIsoTimestamp(message.timestamp)
    }
  });
}
