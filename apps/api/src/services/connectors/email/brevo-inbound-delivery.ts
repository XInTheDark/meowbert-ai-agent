import type { BrevoInboundMessage } from "./brevo-inbound.js";
import type { EmailInboundSettings } from "./inbound-settings.js";
import { processInboundEmailForWorkspace } from "./inbound-ingest.js";
import { findWorkspaceEmailConnectorByRecipient, shouldAllowEmailSender } from "./workspace-email-connector.js";

interface InboundDebugEntry {
  eventType: string;
  level?: "info" | "warn" | "error";
  message: string;
  workspaceId?: string | null;
  bindingId?: string | null;
  details?: Record<string, unknown>;
}

type InboundDebugLog = (entry: InboundDebugEntry) => Promise<void>;

async function resolveInboundRecipient(inbound: BrevoInboundMessage, inboundDomain: string) {
  for (const recipient of inbound.recipients) {
    const connector = await findWorkspaceEmailConnectorByRecipient({ recipientEmail: recipient, inboundDomain });
    if (connector) return { recipient, connector };
  }
  return null;
}

// A batch uses the same per-message routing, sender policy and duplicate detection as a single email.
export async function deliverBrevoInboundMessage(
  inbound: BrevoInboundMessage,
  settings: EmailInboundSettings,
  log: InboundDebugLog
): Promise<{ statusCode: number; payload: Record<string, unknown> }> {
  const acknowledged = { statusCode: 200, payload: { ok: true } };
  await log({
    eventType: "payload_parsed", message: "Parsed inbound email payload.",
    details: {
      messageId: inbound.messageId, fromEmail: inbound.fromEmail, recipients: inbound.recipients,
      subject: inbound.subject, receivedAt: inbound.receivedAt, replyReferenceIds: inbound.replyReferenceIds,
      attachmentCount: inbound.attachments.length, textBodyLength: inbound.textBody?.length ?? 0,
      htmlBodyLength: inbound.htmlBody?.length ?? 0
    }
  });
  if (!settings.inboundDomain) {
    await log({
      eventType: "config_error", level: "error",
      message: "Inbound domain is not configured; message was ignored.",
      details: { messageId: inbound.messageId }
    });
    return acknowledged;
  }
  const match = await resolveInboundRecipient(inbound, settings.inboundDomain);
  if (!match) {
    await log({
      eventType: "recipient_unmatched", level: "warn",
      message: "Inbound recipient does not map to any active workspace email connector.",
      details: { messageId: inbound.messageId, recipients: inbound.recipients, inboundDomain: settings.inboundDomain }
    });
    return acknowledged;
  }
  const { recipient, connector } = match;
  const connectorLog: InboundDebugLog = (entry) => log({ ...entry, workspaceId: connector.workspaceId, bindingId: connector.bindingId });
  if (!shouldAllowEmailSender({ senderPolicy: connector.senderPolicy, trustedSenders: connector.trustedSenders, senderEmail: inbound.fromEmail })) {
    await connectorLog({
      eventType: "sender_blocked", level: "warn",
      message: "Inbound sender is blocked by workspace trusted sender policy.",
      details: {
        messageId: inbound.messageId, recipient, sender: inbound.fromEmail,
        senderPolicy: connector.senderPolicy, trustedSenderCount: connector.trustedSenders.length
      }
    });
    return acknowledged;
  }
  if (!settings.brevoApiKey) {
    await connectorLog({
      eventType: "config_error", level: "error",
      message: "Brevo API key is missing; attachments cannot be downloaded and message cannot be processed.",
      details: { messageId: inbound.messageId }
    });
    return { statusCode: 503, payload: { error: "Brevo API key is not configured for inbound processing" } };
  }
  const processed = await processInboundEmailForWorkspace({
    connector, inbound, recipientAddress: recipient, brevoApiKey: settings.brevoApiKey, debugLog: connectorLog
  });
  if (!processed.processed) {
    await connectorLog({
      eventType: "message_skipped", level: "warn", message: "Inbound message was acknowledged but not processed.",
      details: { messageId: inbound.messageId, reason: processed.reason ?? "unknown" }
    });
    return acknowledged;
  }
  await connectorLog({
    eventType: "message_processed", message: "Inbound message processed successfully.",
    details: { messageId: inbound.messageId, taskId: processed.taskId, environmentId: processed.environmentId, action: processed.action }
  });
  return {
    statusCode: 200,
    payload: { ok: true, taskId: processed.taskId, environmentId: processed.environmentId, action: processed.action }
  };
}
