import fs from "node:fs";
import path from "node:path";
import { ensureEnvironmentRootById } from "../../storage/environment-paths.js";
import { describeConnectorExecutionError } from "../connector-execution-errors.js";
import {
  deliverConnectorMessageToMaster,
  resolveConnectorMasterTarget,
  type ConnectorIngestResult
} from "../connector-master-ingest.js";
import {
  getOrCreateConnectorThread,
  resolveConnectorTaskFromExternalMessage
} from "../connector-threads.js";
import { downloadBrevoAttachment, type BrevoInboundMessage } from "./brevo-inbound.js";
import type { WorkspaceEmailConnector } from "./workspace-email-connector.js";

type EmailIngressResult = ConnectorIngestResult;

type EmailInboundDebugLogFn = (entry: {
  eventType: string;
  level?: "info" | "warn" | "error";
  message: string;
  details?: Record<string, unknown>;
}) => Promise<void>;

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMessageBody(input: BrevoInboundMessage): string {
  const textBody = typeof input.textBody === "string" ? input.textBody.trim() : "";
  if (textBody) {
    return textBody;
  }

  const htmlBody = typeof input.htmlBody === "string" ? input.htmlBody.trim() : "";
  if (!htmlBody) {
    return "[No text content]";
  }

  const stripped = stripHtmlTags(htmlBody);
  return stripped || "[No text content]";
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "item";
}

function normalizeReceivedDateSegment(receivedAt: string): string {
  const parsed = new Date(receivedAt);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return parsed.toISOString().slice(0, 10);
}


async function saveAttachmentsToEnvironment(input: {
  workspaceId: string;
  environmentId: string;
  messageId: string;
  receivedAt: string;
  brevoApiKey: string;
  inbound: BrevoInboundMessage;
}): Promise<string[]> {
  if (!input.inbound.attachments.length) {
    return [];
  }

  const environmentRoot = await ensureEnvironmentRootById(input.environmentId);
  const dateSegment = normalizeReceivedDateSegment(input.receivedAt);
  const messageSegment = sanitizePathSegment(input.messageId);
  const targetDir = path.resolve(environmentRoot, "incoming", "email", dateSegment, messageSegment);

  fs.mkdirSync(targetDir, { recursive: true });

  const savedRelativePaths: string[] = [];
  const usedNames = new Set<string>();

  for (const attachment of input.inbound.attachments) {
    const buffer = await downloadBrevoAttachment({
      downloadToken: attachment.downloadToken,
      apiKey: input.brevoApiKey
    });
    if (!buffer) {
      continue;
    }

    const parsedName = path.parse(attachment.filename);
    const safeBase = sanitizePathSegment(parsedName.name);
    const safeExt = sanitizePathSegment(parsedName.ext.replace(/^\./, ""));
    let finalName = safeExt ? `${safeBase}.${safeExt}` : safeBase;

    let duplicateCounter = 2;
    while (usedNames.has(finalName)) {
      finalName = safeExt ? `${safeBase}_${duplicateCounter}.${safeExt}` : `${safeBase}_${duplicateCounter}`;
      duplicateCounter += 1;
    }
    usedNames.add(finalName);

    const destinationPath = path.resolve(targetDir, finalName);
    if (!destinationPath.startsWith(targetDir)) {
      continue;
    }

    fs.writeFileSync(destinationPath, buffer);
    const relativePath = path.relative(environmentRoot, destinationPath).split(path.sep).join("/");
    savedRelativePaths.push(`/${relativePath}`);
  }

  return savedRelativePaths;
}

function buildInboundMetadataText(input: {
  inbound: BrevoInboundMessage;
  recipientAddress: string;
}): string {
  const body = normalizeMessageBody(input.inbound);

  const lines = [
    "Connector metadata:",
    "- Source: Email",
    `- From: ${input.inbound.fromEmail}`,
    `- To: ${input.recipientAddress}`,
    `- Subject: ${input.inbound.subject}`,
    `- Time: ${input.inbound.receivedAt}`,
    "",
    "Message:",
    body
  ];

  return lines.join("\n");
}

function buildMessageWithAttachmentPaths(baseText: string, attachmentPaths: string[]): string {
  if (!attachmentPaths.length) {
    return baseText;
  }

  return [
    baseText,
    "",
    "Saved attachments:",
    ...attachmentPaths.map((relativePath) => `- ${relativePath}`)
  ].join("\n");
}

export function normalizeEmailThreadSubjectKey(subject: string): string {
  const strippedPrefixes = subject
    .trim()
    .replace(/^(?:\s*(?:re|fw|fwd)\s*:\s*)+/i, "");

  const normalized = strippedPrefixes.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return "(no-subject)";
  }

  return normalized.slice(0, 200);
}

export async function processInboundEmailForWorkspace(input: {
  connector: WorkspaceEmailConnector;
  inbound: BrevoInboundMessage;
  recipientAddress: string;
  brevoApiKey: string;
  debugLog?: EmailInboundDebugLogFn;
}): Promise<EmailIngressResult> {
  const emitDebug = async (entry: Parameters<EmailInboundDebugLogFn>[0]): Promise<void> => {
    if (!input.debugLog) {
      return;
    }
    await input.debugLog(entry);
  };
  if (!input.connector.updatedByUserId) {
    await emitDebug({
      eventType: "billing_user_missing",
      level: "error",
      message: "Workspace email connector is missing its accountable user; inbound message was skipped.",
      details: {
        workspaceId: input.connector.workspaceId,
        bindingId: input.connector.bindingId,
        messageId: input.inbound.messageId
      }
    });
    return {
      processed: false,
      reason: "Workspace email connector is missing its accountable user."
    };
  }

  const thread = await getOrCreateConnectorThread({
    bindingId: input.connector.bindingId,
    workspaceId: input.connector.workspaceId,
    externalChatId: input.inbound.fromEmail,
    externalThreadId: normalizeEmailThreadSubjectKey(input.inbound.subject)
  });
  await emitDebug({
    eventType: "thread_resolved",
    message: "Resolved inbound thread for sender + subject.",
    details: {
      threadId: thread.id,
      externalChatId: input.inbound.fromEmail,
      externalThreadId: normalizeEmailThreadSubjectKey(input.inbound.subject),
    }
  });

  const duplicateTaskId = await resolveConnectorTaskFromExternalMessage({
    threadId: thread.id,
    workspaceId: input.connector.workspaceId,
    externalMessageId: input.inbound.messageId
  });
  if (duplicateTaskId) {
    await emitDebug({
      eventType: "message_duplicate",
      level: "warn",
      message: "Inbound message already mapped to an existing task; skipping duplicate processing.",
      details: {
        threadId: thread.id,
        messageId: input.inbound.messageId,
        mappedTaskId: duplicateTaskId
      }
    });
    return {
      processed: false,
      reason: "duplicate_message"
    };
  }

  const routingText = normalizeMessageBody(input.inbound);

  try {
    const target = await resolveConnectorMasterTarget({
      source: "email",
      workspaceId: input.connector.workspaceId,
      actorUserId: input.connector.updatedByUserId,
      defaultEnvironmentId: input.connector.defaultEnvironmentId,
      routingText
    });
    await emitDebug({
      eventType: "project_resolved",
      message: "Resolved the project Master for this message.",
      details: {
        threadId: thread.id,
        environmentId: target.environmentId,
        masterTaskId: target.masterTaskId,
        routingNote: target.routingNote
      }
    });

    const attachmentPaths = await saveAttachmentsToEnvironment({
      workspaceId: input.connector.workspaceId,
      environmentId: target.environmentId,
      messageId: input.inbound.messageId,
      receivedAt: input.inbound.receivedAt,
      brevoApiKey: input.brevoApiKey,
      inbound: input.inbound
    });
    await emitDebug({
      eventType: "attachments_saved",
      message: "Inbound attachments saved to the project.",
      details: {
        threadId: thread.id,
        savedAttachmentCount: attachmentPaths.length
      }
    });

    const finalMessage = buildMessageWithAttachmentPaths(
      buildInboundMetadataText({
        inbound: input.inbound,
        recipientAddress: input.recipientAddress
      }),
      attachmentPaths
    );
    const delivered = await deliverConnectorMessageToMaster({
      target,
      threadId: thread.id,
      inboundMessageId: input.inbound.messageId,
      message: finalMessage,
      toolsConfig: input.connector.tools,
      agentId: input.connector.agentId
    });
    await emitDebug({
      eventType: "message_delivered",
      message: "Inbound email delivered to the project Master.",
      details: {
        threadId: thread.id,
        taskId: delivered.taskId,
        environmentId: delivered.environmentId,
        savedAttachmentCount: attachmentPaths.length
      }
    });
    return delivered;
  } catch (error) {
    const reason = describeConnectorExecutionError(error);
    if (reason) {
      await emitDebug({
        eventType: "message_rejected",
        level: "warn",
        message: reason,
        details: {
          threadId: thread.id,
          messageId: input.inbound.messageId
        }
      });
      return { processed: false, reason };
    }
    throw error;
  }
}
