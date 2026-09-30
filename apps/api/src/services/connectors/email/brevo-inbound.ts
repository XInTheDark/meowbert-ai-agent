import { normalizeEmailAddress } from "./address-utils.js";

const BREVO_INBOUND_ATTACHMENT_BASE_URL = "https://api.brevo.com/v3/inbound/attachments";

export interface BrevoInboundAttachment {
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  downloadToken: string;
}

export interface BrevoInboundMessage {
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  recipients: string[];
  replyReferenceIds: string[];
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
  receivedAt: string;
  attachments: BrevoInboundAttachment[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function getStringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function parseMailboxAddress(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return getStringField(record, ["Address", "address", "Email", "email", "Value", "value"]);
}

function parseMailboxName(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return getStringField(record, ["Name", "name", "DisplayName", "displayName"]);
}

function parseRecipientList(value: unknown): string[] {
  const candidates: string[] = [];

  if (typeof value === "string") {
    candidates.push(...value.split(","));
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    const email = parseMailboxAddress(value);
    if (email) {
      candidates.push(email);
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        candidates.push(entry);
        continue;
      }

      const email = parseMailboxAddress(entry);
      if (email) {
        candidates.push(email);
      }
    }
  }

  const normalized = candidates
    .map((candidate) => normalizeEmailAddress(candidate))
    .filter((candidate): candidate is string => typeof candidate === "string");

  return Array.from(new Set(normalized));
}

function parseMessageIdList(value: unknown): string[] {
  const values: string[] = [];

  const pushString = (rawValue: string): void => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return;
    }

    const bracketed = trimmed.match(/<[^>\r\n]+>/g);
    if (bracketed && bracketed.length > 0) {
      for (const token of bracketed) {
        const normalized = token.trim();
        if (normalized) {
          values.push(normalized);
        }
      }
      return;
    }

    const splitTokens = trimmed.split(/[\s,]+/);
    for (const token of splitTokens) {
      const normalized = token.trim();
      if (normalized) {
        values.push(normalized);
      }
    }
  };

  if (typeof value === "string") {
    pushString(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        pushString(entry);
      }
    }
  }

  return Array.from(new Set(values));
}

function parseHeaderMap(value: unknown): Record<string, string | string[]> {
  const record = asRecord(value);
  if (!record) {
    return {};
  }

  const normalized: Record<string, string | string[]> = {};
  for (const [key, rawValue] of Object.entries(record)) {
    if (typeof key !== "string" || key.trim().length === 0) {
      continue;
    }

    if (typeof rawValue === "string") {
      normalized[key.toLowerCase()] = rawValue;
      continue;
    }

    if (Array.isArray(rawValue)) {
      const filtered = rawValue.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
      if (filtered.length > 0) {
        normalized[key.toLowerCase()] = filtered;
      }
    }
  }

  return normalized;
}

function normalizeReceivedAt(value: string | null): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function parseAttachmentList(value: unknown): BrevoInboundAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const attachments: BrevoInboundAttachment[] = [];

  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }

    const downloadToken = getStringField(record, ["DownloadToken", "downloadToken"]);
    if (!downloadToken) {
      continue;
    }

    const filename = getStringField(record, ["Name", "name", "Filename", "filename"])
      ?? `attachment-${downloadToken}`;
    const contentType = getStringField(record, ["ContentType", "contentType", "MimeType", "mimeType"]);
    const sizeRaw = record.ContentLength ?? record.contentLength ?? record.Size ?? record.size;
    const sizeNumber = typeof sizeRaw === "number" && Number.isFinite(sizeRaw) && sizeRaw >= 0
      ? Math.floor(sizeRaw)
      : null;

    attachments.push({
      filename,
      contentType,
      sizeBytes: sizeNumber,
      downloadToken
    });
  }

  return attachments;
}

export function parseBrevoInboundPayload(payload: unknown): BrevoInboundMessage | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  const wrappedItems = Array.isArray(record.items)
    ? record.items
    : Array.isArray(record.Items)
      ? record.Items
      : null;
  if (wrappedItems) {
    for (const entry of wrappedItems) {
      const parsed = parseBrevoInboundPayload(entry);
      if (parsed) {
        return parsed;
      }
    }
    return null;
  }

  const headerMap = parseHeaderMap(record.Headers ?? record.headers);
  const messageId =
    getStringField(record, ["MessageId", "MessageID", "messageId", "message_id", "MessageUUID", "messageUuid", "uuid"])
    ?? parseMessageIdList(headerMap["message-id"] ?? headerMap.messageid)[0]
    ?? null;
  const fromRaw =
    parseMailboxAddress(record.From ?? record.from ?? record.Sender ?? record.sender)
    ?? parseMailboxAddress(headerMap.from);

  const toRecipients = parseRecipientList(record.To ?? record.to);
  const ccRecipients = parseRecipientList(record.Cc ?? record.cc);
  const bccRecipients = parseRecipientList(record.Bcc ?? record.bcc);
  const explicitRecipients = parseRecipientList(
    record.Recipients ?? record.recipients ?? record.Recipient ?? record.recipient
  );
  const recipients = Array.from(new Set([...toRecipients, ...ccRecipients, ...bccRecipients, ...explicitRecipients]));

  const inReplyToList = parseMessageIdList(
    record.InReplyTo ?? record.inReplyTo ?? headerMap["in-reply-to"] ?? headerMap["inreplyto"]
  );
  const referencesList = parseMessageIdList(
    record.References ?? record.references ?? headerMap.references
  );
  const replyReferenceIds = Array.from(new Set([...inReplyToList, ...referencesList]));

  if (!messageId || !fromRaw || recipients.length === 0) {
    return null;
  }

  const fromEmail = normalizeEmailAddress(fromRaw);
  if (!fromEmail) {
    return null;
  }

  const fromName =
    getStringField(record, ["FromName", "fromName", "SenderName", "senderName"])
    ?? parseMailboxName(record.From ?? record.from ?? record.Sender ?? record.sender);
  const subject = getStringField(record, ["Subject", "subject"]) ?? "(no subject)";
  const textBody = getStringField(record, [
    "TextBody",
    "textBody",
    "RawTextBody",
    "rawTextBody",
    "ExtractedMarkdownMessage",
    "extractedMarkdownMessage",
    "text"
  ]);
  const htmlBody = getStringField(record, ["HtmlBody", "htmlBody", "RawHtmlBody", "rawHtmlBody", "html"]);
  const receivedAt = normalizeReceivedAt(
    getStringField(record, ["Date", "date", "SentAtDate", "sentAtDate", "ReceivedAt", "receivedAt"])
  );
  const attachments = parseAttachmentList(record.Attachments ?? record.attachments);

  return {
    messageId,
    fromEmail,
    fromName,
    recipients,
    replyReferenceIds,
    subject,
    textBody,
    htmlBody,
    receivedAt,
    attachments
  };
}

export async function downloadBrevoAttachment(input: {
  downloadToken: string;
  apiKey: string;
  timeoutMs?: number;
}): Promise<Buffer | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);

  try {
    const response = await fetch(
      `${BREVO_INBOUND_ATTACHMENT_BASE_URL}/${encodeURIComponent(input.downloadToken)}`,
      {
        method: "GET",
        headers: {
          "api-key": input.apiKey
        },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      return null;
    }

    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
