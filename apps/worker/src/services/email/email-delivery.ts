import { ListmonkClient, type ListmonkMessageHeaders } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { getListmonkClientConfigFromDb } from "./email-provider-settings.js";

interface OutboxRow {
  id: string;
  template_key: string;
  recipient_email: string;
  subject: string;
  payload_json: Record<string, unknown>;
  status: "queued" | "sending" | "sent" | "failed";
  attempt_count: number;
  max_attempts: number;
  campaign_id: string | null;
}

interface TemplateBindingRow {
  provider_template_id: string | number;
}

type TransactionalEmailContentType = "html" | "plain" | "markdown";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseTransactionalHeaders(value: unknown): ListmonkMessageHeaders | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: ListmonkMessageHeaders = [];

  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }

    const headerValues: Record<string, string> = {};
    for (const [key, raw] of Object.entries(record)) {
      const headerName = key.trim();
      if (!headerName) {
        continue;
      }
      if (typeof raw !== "string") {
        continue;
      }
      const headerValue = raw.trim();
      if (!headerValue) {
        continue;
      }
      headerValues[headerName] = headerValue;
    }

    if (Object.keys(headerValues).length > 0) {
      normalized.push(headerValues);
    }
  }

  return normalized.length > 0 ? normalized : undefined;
}

function parseTransactionalContentType(value: unknown): TransactionalEmailContentType | undefined {
  if (value !== "html" && value !== "plain" && value !== "markdown") {
    return undefined;
  }

  return value;
}

export function splitTransactionalPayload(payload: Record<string, unknown>): {
  data: Record<string, unknown>;
  headers?: ListmonkMessageHeaders;
  contentType?: TransactionalEmailContentType;
} {
  const { _meowbert: rawMeta, ...templateData } = payload;
  const metaRecord = asRecord(rawMeta);
  if (!metaRecord) {
    return {
      data: templateData
    };
  }

  const headers = parseTransactionalHeaders(metaRecord.tx_headers);
  const contentType = parseTransactionalContentType(metaRecord.tx_content_type);
  return {
    data: templateData,
    ...(headers ? { headers } : {}),
    ...(contentType ? { contentType } : {})
  };
}

export function resolveTransactionalContentType(input: {
  templateKey: string;
  payloadContentType?: TransactionalEmailContentType;
}): TransactionalEmailContentType {
  if (input.templateKey === "newsletter") {
    return "html";
  }

  return input.payloadContentType ?? "html";
}

function parseTemplateId(rawTemplateId: string | number): number {
  const parsed =
    typeof rawTemplateId === "number"
      ? rawTemplateId
      : Number(rawTemplateId);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid Listmonk template binding id: ${rawTemplateId}`);
  }

  return parsed;
}

async function buildListmonkClient(): Promise<ListmonkClient> {
  const clientConfig = await getListmonkClientConfigFromDb();
  if (!clientConfig) {
    throw new Error("Listmonk provider is disabled or missing credentials in admin connectors settings.");
  }

  return new ListmonkClient(clientConfig);
}

function extractProviderMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const direct = (payload as { id?: unknown }).id;
  if (typeof direct === "string" || typeof direct === "number") {
    return String(direct);
  }

  const data = (payload as { data?: unknown }).data;
  if (data && typeof data === "object") {
    const nested = (data as { id?: unknown }).id;
    if (typeof nested === "string" || typeof nested === "number") {
      return String(nested);
    }
  }

  return null;
}

async function markCampaignProgress(campaignId: string): Promise<void> {
  const counts = await query<{
    total_count: number;
    queued_count: number;
    failed_count: number;
  }>(
    `SELECT COUNT(*)::int AS total_count,
            COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0)::int AS queued_count,
            COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0)::int AS failed_count
       FROM newsletter_recipients
      WHERE campaign_id = $1`,
    [campaignId]
  );

  const row = counts.rows[0];
  if (!row) {
    return;
  }

  let status: "sending" | "completed" | "failed" = "sending";
  if (row.total_count === 0 || row.queued_count === 0) {
    status = row.failed_count > 0 ? "failed" : "completed";
  }

  await query(
    `UPDATE newsletter_campaigns
        SET status = $2
      WHERE id = $1`,
    [campaignId, status]
  );
}

export async function processEmailDeliveryJob(outboxEmailId: string): Promise<void> {
  const outboxResult = await query<OutboxRow>(
    `SELECT id,
            template_key,
            recipient_email,
            subject,
            payload_json,
            status,
            attempt_count,
            max_attempts,
            campaign_id
       FROM email_outbox
      WHERE id = $1`,
    [outboxEmailId]
  );

  if ((outboxResult.rowCount ?? 0) === 0) {
    throw new Error("Outbox email not found");
  }

  const outbox = outboxResult.rows[0];
  if (outbox.status === "sent") {
    return;
  }
  if (outbox.status === "failed" && outbox.attempt_count >= outbox.max_attempts) {
    return;
  }

  const bindingResult = await query<TemplateBindingRow>(
    `SELECT provider_template_id
       FROM email_template_bindings
      WHERE template_key = $1
        AND provider = 'listmonk'
      LIMIT 1`,
    [outbox.template_key]
  );

  if ((bindingResult.rowCount ?? 0) === 0) {
    throw new Error(`Missing Listmonk template binding for key ${outbox.template_key}`);
  }

  const templateId = parseTemplateId(bindingResult.rows[0].provider_template_id);

  const markSendingResult = await query<{ attempt_count: number; max_attempts: number }>(
    `UPDATE email_outbox
        SET status = 'sending',
            attempt_count = attempt_count + 1,
            last_attempt_at = now(),
            updated_at = now()
      WHERE id = $1
      RETURNING attempt_count, max_attempts`,
    [outbox.id]
  );
  const attemptState = markSendingResult.rows[0];

  try {
    const client = await buildListmonkClient();
    const txPayload = splitTransactionalPayload(outbox.payload_json);
    const responsePayload = await client.sendTransactionalEmail({
      templateId,
      subscriberMode: "external",
      subscriberEmails: [outbox.recipient_email],
      data: txPayload.data,
      headers: txPayload.headers,
      subject: outbox.subject,
      contentType: resolveTransactionalContentType({
        templateKey: outbox.template_key,
        payloadContentType: txPayload.contentType
      })
    });

    const providerMessageId = extractProviderMessageId(responsePayload);
    await withTransaction(async (clientTx) => {
      await clientTx.query(
        `UPDATE email_outbox
            SET status = 'sent',
                provider_message_id = $2,
                last_error = NULL,
                sent_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [outbox.id, providerMessageId]
      );

      if (outbox.campaign_id) {
        await clientTx.query(
          `UPDATE newsletter_recipients
              SET status = 'sent',
                  error_detail = NULL,
                  updated_at = now()
            WHERE outbox_email_id = $1`,
          [outbox.id]
        );
      }
    });

    if (outbox.campaign_id) {
      await markCampaignProgress(outbox.campaign_id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isFinalAttempt = attemptState.attempt_count >= attemptState.max_attempts;

    await withTransaction(async (clientTx) => {
      await clientTx.query(
        `UPDATE email_outbox
            SET status = $2,
                last_error = $3,
                updated_at = now()
          WHERE id = $1`,
        [outbox.id, isFinalAttempt ? "failed" : "queued", message]
      );

      if (outbox.campaign_id && isFinalAttempt) {
        await clientTx.query(
          `UPDATE newsletter_recipients
              SET status = 'failed',
                  error_detail = $2,
                  updated_at = now()
            WHERE outbox_email_id = $1`,
          [outbox.id, message]
        );
      }
    });

    if (outbox.campaign_id && isFinalAttempt) {
      await markCampaignProgress(outbox.campaign_id);
    }

    throw error;
  }
}
