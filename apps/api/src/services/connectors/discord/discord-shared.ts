import {
  consumeConnectorPairCodeForConnectorIfPresent,
  type ConsumeConnectorPairCodeResult
} from "../connector-pairing.js";
import {
  findSharedWorkspaceBindingBySlug,
  getConnectorChatContext,
  grantConnectorExternalAccess,
  listSharedWorkspaceCandidates,
  revokeConnectorExternalAccess,
  upsertConnectorChatContext
} from "../shared-connector-chat.js";
import {
  getDiscordBindingById,
  processAuthorizedDiscordMessageForBinding,
  type DiscordMessage,
  type DiscordMessageProcessResult
} from "./index.js";
import { resolveDiscordConnectionMode, syncDiscordBindingBotIdentityIfChanged } from "./discord-binding-state.js";

type DiscordSharedCommand =
  | { command: "workspace_list" }
  | { command: "workspace_use"; slug: string }
  | { command: "open" }
  | { command: "close" }
  | { command: "pair" }
  | { command: "unpair" };

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

function normalizeDiscordSnowflake(input: unknown): string | null {
  if (typeof input !== "string" || !/^\d+$/.test(input)) {
    return null;
  }

  return input;
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

function parseSharedCommand(text: string): DiscordSharedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts = trimmed.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }

  const head = parts[0].toLowerCase();
  if (head === "/open") {
    return { command: "open" };
  }
  if (head === "/close") {
    return { command: "close" };
  }
  if (head === "/pair") {
    return { command: "pair" };
  }
  if (head === "/unpair") {
    return { command: "unpair" };
  }
  if (head !== "/workspace") {
    return null;
  }

  const action = (parts[1] ?? "").toLowerCase();
  if (action === "list") {
    return { command: "workspace_list" };
  }
  if (action === "use") {
    const slug = parts[2]?.trim();
    if (!slug) {
      return null;
    }
    return { command: "workspace_use", slug };
  }

  return null;
}

function formatWorkspaceListMessage(workspaces: Array<{ workspaceSlug: string; workspaceName: string }>): string {
  if (workspaces.length === 0) {
    return "No shared Discord workspaces are available for this account yet.";
  }

  const list = workspaces
    .map((workspace) => `- ${workspace.workspaceSlug} (${workspace.workspaceName})`)
    .join("\n");
  return `Accessible workspaces:\n${list}`;
}

function buildPairingAttemptResponse(outcome: ConsumeConnectorPairCodeResult["outcome"]): string {
  if (outcome === "paired") {
    return "Pairing complete. You're now authorized to send tasks from this Discord account.";
  }
  if (outcome === "expired") {
    return "That pairing code expired. Generate a new one from the Connectors page.";
  }
  if (outcome === "already_used") {
    return "That pairing code was already used. Generate a new one if needed.";
  }
  if (outcome === "already_linked") {
    return "This Discord account is already paired with another Meowbert user.";
  }
  return "Pairing code not recognized. Generate a fresh code from the Connectors page.";
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
    // Best-effort status messaging only.
  });
}

function findTargetMentionedUserId(message: DiscordMessage, botUserId: string | null): string | null {
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  for (const mention of mentions) {
    const mentionId = normalizeDiscordSnowflake(mention?.id);
    if (!mentionId) {
      continue;
    }
    if (botUserId && mentionId === botUserId) {
      continue;
    }
    return mentionId;
  }

  return null;
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

export async function processSharedDiscordMessage(input: {
  message: DiscordMessage;
  sharedBotToken: string | null;
  sharedBotUserId: string | null;
}): Promise<DiscordMessageProcessResult> {
  const message = input.message;
  const inboundMessageId = normalizeDiscordSnowflake(message.id);
  const channelId = normalizeDiscordSnowflake(message.channel_id);
  const authorId = normalizeDiscordSnowflake(message.author?.id);
  const rawText = typeof message.content === "string" ? message.content : "";
  const isBotMessage = message.author?.bot === true;
  const hasAttachments =
    Array.isArray(message.attachments) &&
    message.attachments.some((attachment) => typeof attachment.url === "string" && typeof attachment.filename === "string");

  if (!inboundMessageId || !channelId || !authorId || isBotMessage) {
    return { processed: false };
  }

  if (input.sharedBotUserId && authorId === input.sharedBotUserId) {
    return { processed: false };
  }

  const isDirectMessage = typeof message.guild_id !== "string" || message.guild_id.length === 0;
  const mentionsBot = input.sharedBotUserId ? messageMentionsBot(message, input.sharedBotUserId) : false;
  const text = normalizeInboundMessageText(rawText, input.sharedBotUserId);
  if (!text && !hasAttachments) {
    return { processed: false };
  }

  if (text) {
    const pairingAttempt = await consumeConnectorPairCodeForConnectorIfPresent({
      connectorType: "discord",
      externalUserId: authorId,
      messageText: text
    });
    if (pairingAttempt.handled) {
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: buildPairingAttemptResponse(pairingAttempt.outcome)
      });
      return { processed: false };
    }
  }

  const command = text ? parseSharedCommand(text) : null;

  const storedContext = await getConnectorChatContext({
    connectorType: "discord",
    externalChatId: channelId,
    externalThreadId: ""
  });

  let existingContext = storedContext;
  if (existingContext) {
    const existingBinding = await getDiscordBindingById(existingContext.bindingId);
    if (
      !existingBinding
      || existingBinding.status !== "active"
      || resolveDiscordConnectionMode(existingBinding.config_json) !== "shared"
    ) {
      existingContext = null;
    }
  }

  const channelIsOpen = existingContext?.discordAccessMode === "open";

  if (!command && !isDirectMessage && !channelIsOpen && input.sharedBotUserId && !mentionsBot) {
    return { processed: false };
  }

  const candidateResult = await listSharedWorkspaceCandidates({
    connectorType: "discord",
    externalUserId: authorId
  });
  const isAdmin = candidateResult.identity?.isSuperAdmin === true;

  if (command?.command === "workspace_list") {
    const canUse = isAdmin || candidateResult.candidates.length > 0;
    if (!canUse) {
      return { processed: false };
    }

    await sendDiscordTextMessage({
      botToken: input.sharedBotToken,
      channelId,
      text: formatWorkspaceListMessage(candidateResult.candidates)
    });
    return { processed: false };
  }

  if (command?.command === "workspace_use") {
    const canUse = isAdmin || candidateResult.candidates.length > 0;
    if (!canUse) {
      return { processed: false };
    }

    if (!isDirectMessage && !isAdmin) {
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: "Only mapped Meowbert admins can change workspace context in server channels."
      });
      return { processed: false };
    }

    const targetBinding = await findSharedWorkspaceBindingBySlug({
      connectorType: "discord",
      workspaceSlug: command.slug
    });
    if (!targetBinding) {
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: "Workspace not found or Discord shared connector is not enabled for that workspace."
      });
      return { processed: false };
    }

    const isAllowed =
      isAdmin || candidateResult.candidates.some((candidate) => candidate.bindingId === targetBinding.bindingId);
    if (!isAllowed) {
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: "This Discord account is not authorized for that workspace."
      });
      return { processed: false };
    }

    await upsertConnectorChatContext({
      connectorType: "discord",
      externalChatId: channelId,
      externalThreadId: "",
      bindingId: targetBinding.bindingId,
      workspaceId: targetBinding.workspaceId,
      discordAccessMode: existingContext?.discordAccessMode ?? "restricted",
      updatedByUserId: candidateResult.identity?.userId ?? null
    });

    await sendDiscordTextMessage({
      botToken: input.sharedBotToken,
      channelId,
      text: `Workspace set to ${targetBinding.workspaceSlug}.`
    });
    return { processed: false };
  }

  if (command?.command === "open" || command?.command === "close") {
    if (!isAdmin) {
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: "Only mapped Meowbert admins can run this command."
      });
      return { processed: false };
    }

    if (isDirectMessage) {
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: "This command is only available in server channels."
      });
      return { processed: false };
    }

    let targetContext = existingContext;
    if (!targetContext && candidateResult.candidates.length === 1) {
      const onlyCandidate = candidateResult.candidates[0];
      targetContext = await upsertConnectorChatContext({
        connectorType: "discord",
        externalChatId: channelId,
        externalThreadId: "",
        bindingId: onlyCandidate.bindingId,
        workspaceId: onlyCandidate.workspaceId,
        discordAccessMode: "restricted",
        updatedByUserId: candidateResult.identity?.userId ?? null
      });
    }

    if (!targetContext) {
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: "Workspace context is not set for this channel. Use @Meowbert /workspace use <slug> first."
      });
      return { processed: false };
    }

    const accessMode = command.command === "open" ? "open" : "restricted";
    await upsertConnectorChatContext({
      connectorType: "discord",
      externalChatId: channelId,
      externalThreadId: "",
      bindingId: targetContext.bindingId,
      workspaceId: targetContext.workspaceId,
      discordAccessMode: accessMode,
      updatedByUserId: candidateResult.identity?.userId ?? null
    });

    await sendDiscordTextMessage({
      botToken: input.sharedBotToken,
      channelId,
      text: command.command === "open"
        ? "Channel opened. Anyone in this channel can chat with Meowbert."
        : "Channel closed. Access now follows pairing/grant rules."
    });
    return { processed: false };
  }

  if (command?.command === "pair" || command?.command === "unpair") {
    if (!isAdmin) {
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: "Only mapped Meowbert admins can run this command."
      });
      return { processed: false };
    }

    let targetContext = existingContext;
    if (!targetContext && candidateResult.candidates.length === 1) {
      const onlyCandidate = candidateResult.candidates[0];
      targetContext = await upsertConnectorChatContext({
        connectorType: "discord",
        externalChatId: channelId,
        externalThreadId: "",
        bindingId: onlyCandidate.bindingId,
        workspaceId: onlyCandidate.workspaceId,
        discordAccessMode: "restricted",
        updatedByUserId: candidateResult.identity?.userId ?? null
      });
    }

    if (!targetContext) {
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: "Workspace context is not set for this chat. Use /workspace use <slug> first."
      });
      return { processed: false };
    }

    const targetMentionedUserId = findTargetMentionedUserId(message, input.sharedBotUserId);
    if (!targetMentionedUserId) {
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: "Mention a Discord user: /pair @user or /unpair @user"
      });
      return { processed: false };
    }

    if (command.command === "pair") {
      await grantConnectorExternalAccess({
        bindingId: targetContext.bindingId,
        workspaceId: targetContext.workspaceId,
        externalUserId: targetMentionedUserId,
        grantedByUserId: candidateResult.identity?.userId ?? null
      });
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: "User granted access for this workspace."
      });
      return { processed: false };
    }

    const removed = await revokeConnectorExternalAccess({
      bindingId: targetContext.bindingId,
      externalUserId: targetMentionedUserId
    });
    await sendDiscordTextMessage({
      botToken: input.sharedBotToken,
      channelId,
      text: removed ? "User access revoked for this workspace." : "No direct grant found for that user."
    });
    return { processed: false };
  }

  let activeContext = existingContext;
  if (!activeContext) {
    if (candidateResult.candidates.length === 1) {
      const onlyCandidate = candidateResult.candidates[0];
      activeContext = await upsertConnectorChatContext({
        connectorType: "discord",
        externalChatId: channelId,
        externalThreadId: "",
        bindingId: onlyCandidate.bindingId,
        workspaceId: onlyCandidate.workspaceId,
        discordAccessMode: "restricted",
        updatedByUserId: candidateResult.identity?.userId ?? null
      });
    } else if (isDirectMessage && candidateResult.candidates.length > 1) {
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: "Multiple workspaces are available. Use /workspace list then /workspace use <slug>."
      });
      return { processed: false };
    } else {
      if (!isDirectMessage && mentionsBot) {
        await sendDiscordTextMessage({
          botToken: input.sharedBotToken,
          channelId,
          text:
            candidateResult.candidates.length > 1
              ? "This channel is not linked to a workspace yet. Run /workspace use <slug> here first."
              : "This Discord account is not authorized for a shared workspace in this channel yet."
        });
      }
      return { processed: false };
    }
  }

  const isSenderAuthorizedForWorkspace =
    isAdmin ||
    candidateResult.candidates.some((candidate) => candidate.bindingId === activeContext.bindingId);
  const canSendInChannel = activeContext.discordAccessMode === "open" || isSenderAuthorizedForWorkspace;
  if (!canSendInChannel) {
    if (mentionsBot) {
      await sendDiscordTextMessage({
        botToken: input.sharedBotToken,
        channelId,
        text: "This channel is restricted. Ask an admin to run /open here or grant you access."
      });
    }
    return { processed: false };
  }

  const binding = await getDiscordBindingById(activeContext.bindingId);
  if (!binding || binding.status !== "active") {
    return { processed: false };
  }

  const resolvedBinding =
    resolveDiscordConnectionMode(binding.config_json) === "shared"
      ? {
          ...binding,
          config_json: await syncDiscordBindingBotIdentityIfChanged({
            bindingId: binding.id,
            currentConfigJson: binding.config_json,
            activeBotUserId: input.sharedBotUserId
          })
        }
      : binding;
  if (!candidateResult.identity?.userId) {
    await sendDiscordTextMessage({
      botToken: input.sharedBotToken,
      channelId,
      text: "Pair your Discord account before sending shared-workspace task requests."
    });
    return { processed: false };
  }

  return processAuthorizedDiscordMessageForBinding({
    binding: resolvedBinding,
    inboundMessageId,
    channelId,
    replyToText: typeof message.referenced_message?.content === "string" ? message.referenced_message.content : null,
    text,
    attachments: message.attachments,
    actorUserId: candidateResult.identity.userId,
    botTokenOverride: input.sharedBotToken,
    expectedConnectionMode: "shared",
    receivedByBotUserId: input.sharedBotUserId,
    messageMetadata: {
      authorId,
      authorDisplayName: resolveDiscordAuthorDisplayName(message.author),
      guildId: isDirectMessage ? null : normalizeDiscordSnowflake(message.guild_id),
      receivedAt: normalizeIsoTimestamp(message.timestamp)
    }
  });
}
