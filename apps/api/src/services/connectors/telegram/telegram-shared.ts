import {
  consumeConnectorPairCodeForConnectorIfPresent,
  type ConsumeConnectorPairCodeResult
} from "../connector-pairing.js";
import {
  findSharedWorkspaceBindingBySlug,
  getConnectorChatContext,
  listSharedWorkspaceCandidates,
  upsertConnectorChatContext
} from "../shared-connector-chat.js";
import {
  getTelegramBindingById,
  processAuthorizedTelegramMessageForBinding,
  type TelegramUpdate,
  type TelegramUpdateProcessResult
} from "./index.js";

interface TelegramWorkspaceCommand {
  command: "workspace_list" | "workspace_use";
  slug?: string;
}

function parseWorkspaceCommand(text: string): TelegramWorkspaceCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts = trimmed.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }

  const head = parts[0].toLowerCase();
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

async function sendTelegramTextMessage(input: {
  botToken: string | null;
  chatId: string;
  threadId: string;
  text: string;
}): Promise<void> {
  if (!input.botToken || !input.text.trim()) {
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
    // Best-effort status messaging only.
  });
}

function formatWorkspaceListMessage(workspaces: Array<{ workspaceSlug: string; workspaceName: string }>): string {
  if (workspaces.length === 0) {
    return "No shared Telegram workspaces are available for this account yet.";
  }

  const list = workspaces
    .map((workspace) => `- ${workspace.workspaceSlug} (${workspace.workspaceName})`)
    .join("\n");
  return `Accessible workspaces:\n${list}`;
}

function buildPairingAttemptResponse(outcome: ConsumeConnectorPairCodeResult["outcome"]): string {
  if (outcome === "paired") {
    return "Pairing complete. You're now authorized to send tasks from this Telegram account.";
  }
  if (outcome === "expired") {
    return "That pairing code expired. Generate a new one from the Connectors page.";
  }
  if (outcome === "already_used") {
    return "That pairing code was already used. Generate a new one if needed.";
  }
  if (outcome === "already_linked") {
    return "That Telegram account is already paired with another Meowbert user.";
  }
  return "Pairing code not recognized. Generate a fresh code from the Connectors page.";
}

export async function processSharedTelegramUpdate(input: {
  update: TelegramUpdate;
  sharedBotToken: string | null;
}): Promise<TelegramUpdateProcessResult> {
  const update = input.update;
  const rawText = (update.message?.text ?? update.message?.caption ?? "").trim();
  const chatIdRaw = update.message?.chat.id;
  const messageIdRaw = update.message?.message_id;
  const senderUserIdRaw = update.message?.from?.id;
  const isSenderBot = update.message?.from?.is_bot === true;
  const hasAttachments = !!(update.message?.photo?.length || update.message?.document);

  if ((!rawText && !hasAttachments) || !chatIdRaw || typeof senderUserIdRaw !== "number" || !Number.isInteger(senderUserIdRaw) || isSenderBot) {
    return { processed: false };
  }

  // Shared Telegram v1 is DM-only. Telegram private chat ids are positive integers.
  if (chatIdRaw <= 0) {
    return { processed: false };
  }

  const chatId = String(chatIdRaw);
  const threadId = String(update.message?.message_thread_id ?? "");
  const senderUserId = String(senderUserIdRaw);
  const inboundMessageId =
    typeof messageIdRaw === "number" && Number.isInteger(messageIdRaw)
      ? String(messageIdRaw)
      : null;

  if (rawText) {
    const pairingAttempt = await consumeConnectorPairCodeForConnectorIfPresent({
      connectorType: "telegram",
      externalUserId: senderUserId,
      messageText: rawText
    });

    if (pairingAttempt.handled) {
      await sendTelegramTextMessage({
        botToken: input.sharedBotToken,
        chatId,
        threadId,
        text: buildPairingAttemptResponse(pairingAttempt.outcome)
      });
      return { processed: false };
    }
  }

  const command = rawText ? parseWorkspaceCommand(rawText) : null;
  const candidateResult = await listSharedWorkspaceCandidates({
    connectorType: "telegram",
    externalUserId: senderUserId
  });

  if (command?.command === "workspace_list") {
    await sendTelegramTextMessage({
      botToken: input.sharedBotToken,
      chatId,
      threadId,
      text: formatWorkspaceListMessage(candidateResult.candidates)
    });
    return { processed: false };
  }

  if (command?.command === "workspace_use") {
    const targetBinding = await findSharedWorkspaceBindingBySlug({
      connectorType: "telegram",
      workspaceSlug: command.slug ?? ""
    });

    if (!targetBinding) {
      await sendTelegramTextMessage({
        botToken: input.sharedBotToken,
        chatId,
        threadId,
        text: "Workspace not found or Telegram shared connector is not enabled for that workspace."
      });
      return { processed: false };
    }

    const isAllowed =
      candidateResult.identity?.isSuperAdmin === true ||
      candidateResult.candidates.some((candidate) => candidate.bindingId === targetBinding.bindingId);

    if (!isAllowed) {
      await sendTelegramTextMessage({
        botToken: input.sharedBotToken,
        chatId,
        threadId,
        text: "This Telegram account is not authorized for that workspace."
      });
      return { processed: false };
    }

    await upsertConnectorChatContext({
      connectorType: "telegram",
      externalChatId: chatId,
      externalThreadId: threadId,
      bindingId: targetBinding.bindingId,
      workspaceId: targetBinding.workspaceId,
      updatedByUserId: candidateResult.identity?.userId ?? null
    });

    await sendTelegramTextMessage({
      botToken: input.sharedBotToken,
      chatId,
      threadId,
      text: `Workspace set to ${targetBinding.workspaceSlug}.`
    });
    return { processed: false };
  }

  if (candidateResult.candidates.length === 0) {
    return { processed: false };
  }

  const existingContext = await getConnectorChatContext({
    connectorType: "telegram",
    externalChatId: chatId,
    externalThreadId: threadId
  });

  const selectedCandidate = existingContext
    ? candidateResult.candidates.find((candidate) => candidate.bindingId === existingContext.bindingId) ?? null
    : null;

  let activeCandidate = selectedCandidate;
  if (!activeCandidate) {
    if (candidateResult.candidates.length === 1) {
      activeCandidate = candidateResult.candidates[0];
      await upsertConnectorChatContext({
        connectorType: "telegram",
        externalChatId: chatId,
        externalThreadId: threadId,
        bindingId: activeCandidate.bindingId,
        workspaceId: activeCandidate.workspaceId,
        updatedByUserId: candidateResult.identity?.userId ?? null
      });
    } else {
      await sendTelegramTextMessage({
        botToken: input.sharedBotToken,
        chatId,
        threadId,
        text: "Multiple workspaces are available. Use /workspace list then /workspace use <slug>."
      });
      return { processed: false };
    }
  }

  const binding = await getTelegramBindingById(activeCandidate.bindingId);
  if (!binding || binding.status !== "active") {
    return { processed: false };
  }
  if (!candidateResult.identity?.userId) {
    await sendTelegramTextMessage({
      botToken: input.sharedBotToken,
      chatId,
      threadId,
      text: "Pair your Telegram account before sending shared-workspace task requests."
    });
    return { processed: false };
  }

  return processAuthorizedTelegramMessageForBinding({
    binding,
    message: update.message!,
    rawText,
    chatId,
    threadId,
    inboundMessageId,
    actorUserId: candidateResult.identity.userId,
    botTokenOverride: input.sharedBotToken
  });
}
