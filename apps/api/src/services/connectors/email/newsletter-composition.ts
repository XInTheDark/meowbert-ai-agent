import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";

export type NewsletterBodyFormat = "markdown" | "html";

export function renderNewsletterBodyHtml(input: {
  body: string;
  bodyFormat: NewsletterBodyFormat;
}): string {
  const normalizedBody = input.body.trim();
  if (!normalizedBody) {
    return "";
  }

  if (input.bodyFormat === "html") {
    return normalizedBody;
  }

  return micromark(normalizedBody, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()]
  });
}

export function buildNewsletterTemplatePayload(input: {
  subject: string;
  body: string;
  bodyFormat: NewsletterBodyFormat;
  unsubscribeUrl?: string | null;
}): Record<string, unknown> {
  return {
    subject: input.subject,
    body_html: renderNewsletterBodyHtml({
      body: input.body,
      bodyFormat: input.bodyFormat
    }),
    ...(input.unsubscribeUrl ? { unsubscribe_url: input.unsubscribeUrl } : {})
  };
}

export function normalizeNewsletterRecipientEmails(recipientEmails: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawEmail of recipientEmails) {
    const email = rawEmail.trim().toLowerCase();
    if (!email || seen.has(email)) {
      continue;
    }

    seen.add(email);
    normalized.push(email);
  }

  return normalized;
}
