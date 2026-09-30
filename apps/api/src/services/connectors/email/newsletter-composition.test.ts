import { describe, expect, it } from "vitest";
import {
  buildNewsletterTemplatePayload,
  normalizeNewsletterRecipientEmails,
  renderNewsletterBodyHtml
} from "./newsletter-composition.js";

describe("renderNewsletterBodyHtml", () => {
  it("converts markdown into html", () => {
    const html = renderNewsletterBodyHtml({
      body: "## Weekly update\n\n- Faster sends\n- Better previews",
      bodyFormat: "markdown"
    });

    expect(html).toContain("<h2>Weekly update</h2>");
    expect(html).toContain("<li>Faster sends</li>");
    expect(html).toContain("<li>Better previews</li>");
  });

  it("passes html mode through unchanged", () => {
    expect(
      renderNewsletterBodyHtml({
        body: "<p><strong>Hello</strong> world.</p>",
        bodyFormat: "html"
      })
    ).toBe("<p><strong>Hello</strong> world.</p>");
  });
});

describe("buildNewsletterTemplatePayload", () => {
  it("stores rendered html body content and an optional unsubscribe url", () => {
    expect(
      buildNewsletterTemplatePayload({
        subject: "Weekly update",
        body: "## Hello",
        bodyFormat: "markdown",
        unsubscribeUrl: "https://example.com/unsubscribe"
      })
    ).toEqual({
      subject: "Weekly update",
      body_html: "<h2>Hello</h2>",
      unsubscribe_url: "https://example.com/unsubscribe"
    });
  });

  it("omits the unsubscribe url when it is not provided", () => {
    expect(
      buildNewsletterTemplatePayload({
        subject: "Weekly update",
        body: "<p>Hello</p>",
        bodyFormat: "html"
      })
    ).toEqual({
      subject: "Weekly update",
      body_html: "<p>Hello</p>"
    });
  });
});

describe("normalizeNewsletterRecipientEmails", () => {
  it("trims, lowercases, and deduplicates trial recipients", () => {
    expect(
      normalizeNewsletterRecipientEmails([
        " Test@Example.com ",
        "friend@example.com",
        "test@example.com",
        "",
        "FRIEND@example.com"
      ])
    ).toEqual([
      "test@example.com",
      "friend@example.com"
    ]);
  });
});
