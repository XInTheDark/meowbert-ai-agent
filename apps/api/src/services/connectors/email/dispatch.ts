import { withTransaction } from "../../../lib/db.js";
import { config } from "../../../lib/config.js";
import { createSignedUserToken } from "./tokens.js";
import { enqueueOutboxEmail, insertOutboxEmail } from "./outbox.js";
import { buildNewsletterTemplatePayload } from "./newsletter-composition.js";

function buildAppUrl(pathname: string, params: Record<string, string> = {}): string {
  const url = new URL(pathname, config.email.appBaseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function queueSignupVerificationEmail(input: {
  userId: string;
  email: string;
  code: string;
  expiresMinutes: number;
}): Promise<string> {
  const outboxEmailId = await withTransaction(async (client) =>
    insertOutboxEmail(client, {
      messageType: "signup_verification",
      templateKey: "signup_verification",
      recipientUserId: input.userId,
      recipientEmail: input.email,
      subject: "Verify your Meowbert account",
      payload: {
        code: input.code,
        expires_minutes: input.expiresMinutes
      }
    })
  );

  await enqueueOutboxEmail(outboxEmailId);
  return outboxEmailId;
}

export async function queuePasswordResetEmail(input: {
  userId: string;
  email: string;
  token: string;
  expiresMinutes: number;
}): Promise<string> {
  const resetUrl = buildAppUrl("/auth", {
    mode: "reset-password",
    token: input.token
  });

  const outboxEmailId = await withTransaction(async (client) =>
    insertOutboxEmail(client, {
      messageType: "password_reset",
      templateKey: "password_reset",
      recipientUserId: input.userId,
      recipientEmail: input.email,
      subject: "Reset your Meowbert password",
      payload: {
        reset_url: resetUrl,
        expires_minutes: input.expiresMinutes
      }
    })
  );

  await enqueueOutboxEmail(outboxEmailId);
  return outboxEmailId;
}

export async function queueNewsletterEmail(input: {
  userId: string | null;
  email: string;
  subject: string;
  body: string;
  campaignId: string;
}): Promise<string> {
  const unsubscribeToken =
    input.userId
      ? createSignedUserToken({
          userId: input.userId,
          purpose: "newsletter_unsubscribe",
          expiresAtMs: Date.now() + 30 * 24 * 60 * 60 * 1000
        })
      : null;
  const unsubscribeUrl = unsubscribeToken
    ? buildAppUrl("/auth", {
        mode: "unsubscribe",
        token: unsubscribeToken
      })
    : buildAppUrl("/auth");

  const outboxEmailId = await withTransaction(async (client) =>
    insertOutboxEmail(client, {
      messageType: "newsletter",
      templateKey: "newsletter",
      recipientUserId: input.userId,
      recipientEmail: input.email,
      subject: input.subject,
      campaignId: input.campaignId,
      payload: buildNewsletterTemplatePayload({
        subject: input.subject,
        body: input.body,
        bodyFormat: "html",
        unsubscribeUrl
      })
    })
  );

  await enqueueOutboxEmail(outboxEmailId);
  return outboxEmailId;
}
