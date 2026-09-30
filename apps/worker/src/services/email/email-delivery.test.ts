import { describe, expect, it } from "vitest";
import { resolveTransactionalContentType, splitTransactionalPayload } from "./email-delivery.js";

describe("splitTransactionalPayload", () => {
  it("preserves transactional metadata while stripping internal fields", () => {
    expect(
      splitTransactionalPayload({
        subject: "What we shipped this week",
        body_html: "<p>hello</p>",
        unsubscribe_url: "https://example.com/unsubscribe",
        _meowbert: {
          tx_content_type: "markdown",
          tx_headers: [{ "X-Test": "newsletter" }]
        }
      })
    ).toEqual({
      data: {
        subject: "What we shipped this week",
        body_html: "<p>hello</p>",
        unsubscribe_url: "https://example.com/unsubscribe"
      },
      headers: [{ "X-Test": "newsletter" }],
      contentType: "markdown"
    });
  });

  it("falls back cleanly when transactional metadata is invalid", () => {
    expect(
      splitTransactionalPayload({
        body_html: "<p>Hello</p>",
        _meowbert: {
          tx_content_type: "not-real",
          tx_headers: "oops"
        }
      })
    ).toEqual({
      data: {
        body_html: "<p>Hello</p>"
      }
    });
  });
});

describe("resolveTransactionalContentType", () => {
  it("forces newsletter deliveries to stay on html", () => {
    expect(
      resolveTransactionalContentType({
        templateKey: "newsletter",
        payloadContentType: "markdown"
      })
    ).toBe("html");
  });

  it("uses payload content types for non-newsletter templates", () => {
    expect(
      resolveTransactionalContentType({
        templateKey: "task_result",
        payloadContentType: "plain"
      })
    ).toBe("plain");
  });
});
