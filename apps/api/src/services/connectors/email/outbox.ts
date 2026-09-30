import { buildEmailDeliveryQueueJobId } from "@meowbert/shared";
import type { PoolClient } from "pg";
import { config } from "../../../lib/config.js";
import { query } from "../../../lib/db.js";
import { emailQueue } from "../../../lib/queue.js";
import type { OutboundEmailDraft } from "./outbound-types.js";

export interface EmailOutboxRow {
  id: string;
  status: "queued" | "sending" | "sent" | "failed";
}

export async function insertOutboxEmail(client: PoolClient, input: OutboundEmailDraft): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO email_outbox (
      message_type,
      template_key,
      recipient_user_id,
      recipient_email,
      subject,
      payload_json,
      campaign_id,
      status,
      max_attempts
    )
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'queued', $8)
    RETURNING id`,
    [
      input.messageType,
      input.templateKey,
      input.recipientUserId,
      input.recipientEmail,
      input.subject,
      JSON.stringify(input.payload),
      input.campaignId ?? null,
      config.email.queue.maxAttempts
    ]
  );

  return result.rows[0].id;
}

export async function enqueueOutboxEmail(outboxEmailId: string): Promise<void> {
  await emailQueue.add(
    buildEmailDeliveryQueueJobId(outboxEmailId),
    {
      outboxEmailId
    },
    {
      jobId: buildEmailDeliveryQueueJobId(outboxEmailId),
      removeOnComplete: 2000,
      removeOnFail: 1000,
      attempts: config.email.queue.maxAttempts,
      backoff: {
        type: "exponential",
        delay: config.email.queue.retryBaseMs
      }
    }
  );
}

export async function enqueueOutboxEmails(outboxEmailIds: string[]): Promise<void> {
  for (const outboxEmailId of outboxEmailIds) {
    await enqueueOutboxEmail(outboxEmailId);
  }
}

export async function getOutboxEmailStatus(outboxEmailId: string): Promise<EmailOutboxRow | null> {
  const result = await query<EmailOutboxRow>(
    `SELECT id, status
       FROM email_outbox
      WHERE id = $1`,
    [outboxEmailId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  return result.rows[0];
}
