import { withTransaction, query } from "../../../lib/db.js";
import { config } from "../../../lib/config.js";
import { createSignedUserToken } from "./tokens.js";
import { enqueueOutboxEmails, insertOutboxEmail } from "./outbox.js";
import {
  buildNewsletterTemplatePayload,
  type NewsletterBodyFormat,
  normalizeNewsletterRecipientEmails,
  renderNewsletterBodyHtml
} from "./newsletter-composition.js";

interface NewsletterRecipientRow {
  id: string;
  email: string;
}

export interface NewsletterCampaignSummary {
  id: string;
  subject: string;
  bodyText: string;
  status: "queued" | "sending" | "completed" | "failed";
  createdByUserId: string | null;
  createdAt: string;
  totalRecipients: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
}

function buildAppUrl(pathname: string, params: Record<string, string> = {}): string {
  const url = new URL(pathname, config.email.appBaseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function mapSummaryRow(row: {
  id: string;
  subject: string;
  body_text: string;
  status: "queued" | "sending" | "completed" | "failed";
  created_by_user_id: string | null;
  created_at: string;
  total_recipients: number;
  queued_count: number;
  sent_count: number;
  failed_count: number;
}): NewsletterCampaignSummary {
  return {
    id: row.id,
    subject: row.subject,
    bodyText: row.body_text,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    totalRecipients: Number(row.total_recipients ?? 0),
    queuedCount: Number(row.queued_count ?? 0),
    sentCount: Number(row.sent_count ?? 0),
    failedCount: Number(row.failed_count ?? 0)
  };
}

async function getCampaignSummary(campaignId: string): Promise<NewsletterCampaignSummary> {
  const result = await query<{
    id: string;
    subject: string;
    body_text: string;
    status: "queued" | "sending" | "completed" | "failed";
    created_by_user_id: string | null;
    created_at: string;
    total_recipients: number;
    queued_count: number;
    sent_count: number;
    failed_count: number;
  }>(
    `SELECT c.id,
            c.subject,
            c.body_text,
            c.status,
            c.created_by_user_id,
            c.created_at::text,
            COUNT(nr.id)::int AS total_recipients,
            COALESCE(SUM(CASE WHEN nr.status = 'queued' THEN 1 ELSE 0 END), 0)::int AS queued_count,
            COALESCE(SUM(CASE WHEN nr.status = 'sent' THEN 1 ELSE 0 END), 0)::int AS sent_count,
            COALESCE(SUM(CASE WHEN nr.status = 'failed' THEN 1 ELSE 0 END), 0)::int AS failed_count
       FROM newsletter_campaigns c
       LEFT JOIN newsletter_recipients nr ON nr.campaign_id = c.id
      WHERE c.id = $1
      GROUP BY c.id`,
    [campaignId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("Newsletter campaign not found");
  }

  return mapSummaryRow(result.rows[0]);
}

export async function createNewsletterCampaign(input: {
  subject: string;
  body: string;
  bodyFormat: NewsletterBodyFormat;
  createdByUserId: string;
}): Promise<NewsletterCampaignSummary> {
  const normalizedSubject = input.subject.trim();
  const normalizedBody = input.body.trim();
  const renderedBodyHtml = renderNewsletterBodyHtml({
    body: normalizedBody,
    bodyFormat: input.bodyFormat
  });

  if (!normalizedSubject) {
    throw new Error("Newsletter subject is required.");
  }
  if (!normalizedBody) {
    throw new Error("Newsletter body is required.");
  }

  const { campaignId, outboxEmailIds } = await withTransaction(async (client) => {
    const campaignResult = await client.query<{ id: string }>(
      `INSERT INTO newsletter_campaigns (subject, body_text, created_by_user_id, status)
       VALUES ($1, $2, $3, 'queued')
       RETURNING id`,
      [normalizedSubject, renderedBodyHtml, input.createdByUserId]
    );

    const campaignId = campaignResult.rows[0].id;
    const recipientsResult = await client.query<NewsletterRecipientRow>(
      `SELECT id, email
         FROM users
        WHERE is_active = true
          AND email_verified_at IS NOT NULL
          AND newsletter_subscribed = true`
    );

    const outboxEmailIds: string[] = [];
    for (const recipient of recipientsResult.rows) {
      const unsubscribeToken = createSignedUserToken({
        userId: recipient.id,
        purpose: "newsletter_unsubscribe",
        expiresAtMs: Date.now() + 30 * 24 * 60 * 60 * 1000
      });
      const unsubscribeUrl = buildAppUrl("/auth", {
        mode: "unsubscribe",
        token: unsubscribeToken
      });

      const outboxEmailId = await insertOutboxEmail(client, {
        messageType: "newsletter",
        templateKey: "newsletter",
        recipientUserId: recipient.id,
        recipientEmail: recipient.email,
        subject: normalizedSubject,
        campaignId,
        payload: buildNewsletterTemplatePayload({
          subject: normalizedSubject,
          body: normalizedBody,
          bodyFormat: input.bodyFormat,
          unsubscribeUrl
        })
      });

      await client.query(
        `INSERT INTO newsletter_recipients (campaign_id, user_id, email, outbox_email_id, status)
         VALUES ($1, $2, $3, $4, 'queued')`,
        [campaignId, recipient.id, recipient.email, outboxEmailId]
      );
      outboxEmailIds.push(outboxEmailId);
    }

    await client.query(
      `UPDATE newsletter_campaigns
          SET status = CASE
            WHEN $2::int = 0 THEN 'completed'
            ELSE 'sending'
          END
        WHERE id = $1`,
      [campaignId, outboxEmailIds.length]
    );

    return {
      campaignId,
      outboxEmailIds
    };
  });

  await enqueueOutboxEmails(outboxEmailIds);
  return getCampaignSummary(campaignId);
}

export async function sendTrialNewsletter(input: {
  subject: string;
  body: string;
  bodyFormat: NewsletterBodyFormat;
  recipientEmails: string[];
}): Promise<{ queuedCount: number; recipientEmails: string[] }> {
  const normalizedSubject = input.subject.trim();
  const normalizedBody = input.body.trim();
  const normalizedRecipientEmails = normalizeNewsletterRecipientEmails(input.recipientEmails);

  if (!normalizedSubject) {
    throw new Error("Newsletter subject is required.");
  }
  if (!normalizedBody) {
    throw new Error("Newsletter body is required.");
  }
  if (normalizedRecipientEmails.length === 0) {
    throw new Error("At least one trial recipient email is required.");
  }

  const outboxEmailIds = await withTransaction(async (client) => {
    const queuedIds: string[] = [];

    for (const recipientEmail of normalizedRecipientEmails) {
      const outboxEmailId = await insertOutboxEmail(client, {
        messageType: "newsletter",
        templateKey: "newsletter",
        recipientUserId: null,
        recipientEmail,
        subject: normalizedSubject,
        payload: buildNewsletterTemplatePayload({
          subject: normalizedSubject,
          body: normalizedBody,
          bodyFormat: input.bodyFormat
        })
      });
      queuedIds.push(outboxEmailId);
    }

    return queuedIds;
  });

  await enqueueOutboxEmails(outboxEmailIds);
  return {
    queuedCount: outboxEmailIds.length,
    recipientEmails: normalizedRecipientEmails
  };
}

export async function listNewsletterCampaigns(input: { limit: number }): Promise<NewsletterCampaignSummary[]> {
  const result = await query<{
    id: string;
    subject: string;
    body_text: string;
    status: "queued" | "sending" | "completed" | "failed";
    created_by_user_id: string | null;
    created_at: string;
    total_recipients: number;
    queued_count: number;
    sent_count: number;
    failed_count: number;
  }>(
    `SELECT c.id,
            c.subject,
            c.body_text,
            c.status,
            c.created_by_user_id,
            c.created_at::text,
            COUNT(nr.id)::int AS total_recipients,
            COALESCE(SUM(CASE WHEN nr.status = 'queued' THEN 1 ELSE 0 END), 0)::int AS queued_count,
            COALESCE(SUM(CASE WHEN nr.status = 'sent' THEN 1 ELSE 0 END), 0)::int AS sent_count,
            COALESCE(SUM(CASE WHEN nr.status = 'failed' THEN 1 ELSE 0 END), 0)::int AS failed_count
       FROM newsletter_campaigns c
       LEFT JOIN newsletter_recipients nr ON nr.campaign_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT $1`,
    [Math.max(1, Math.min(100, Math.floor(input.limit)))]
  );

  return result.rows.map(mapSummaryRow);
}
