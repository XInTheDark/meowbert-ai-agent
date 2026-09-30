import { describe, expect, it } from "vitest";
import { parseBrevoInboundPayload } from "./brevo-inbound.js";

describe("parseBrevoInboundPayload", () => {
  it("returns null when required fields are missing", () => {
    expect(parseBrevoInboundPayload(null)).toBeNull();
    expect(parseBrevoInboundPayload({})).toBeNull();
    expect(
      parseBrevoInboundPayload({
        MessageId: "m-1",
        From: "sender@example.com"
      })
    ).toBeNull();
  });

  it("parses and normalizes Brevo payload fields", () => {
    const parsed = parseBrevoInboundPayload({
      MessageId: "message-123",
      From: "Sender Name <Sender@Example.COM>",
      To: ["Team Inbox <Team+Ops@Inbound.example.com>"],
      Cc: "TEAM+OPS@inbound.example.com, second@inbound.example.com",
      Subject: "Build result",
      TextBody: "Latest build artifacts are attached.",
      Date: "2026-03-06T03:04:05.000Z",
      Attachments: [
        {
          Name: "artifact.zip",
          ContentType: "application/zip",
          ContentLength: 42,
          DownloadToken: "dl-token-1"
        },
        {
          Filename: "trace.log",
          downloadToken: "dl-token-2"
        }
      ]
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.messageId).toBe("message-123");
    expect(parsed?.fromEmail).toBe("sender@example.com");
    expect(parsed?.subject).toBe("Build result");
    expect(parsed?.textBody).toBe("Latest build artifacts are attached.");
    expect(parsed?.recipients).toEqual([
      "team+ops@inbound.example.com",
      "second@inbound.example.com"
    ]);
    expect(parsed?.replyReferenceIds).toEqual([]);
    expect(parsed?.attachments).toEqual([
      {
        filename: "artifact.zip",
        contentType: "application/zip",
        sizeBytes: 42,
        downloadToken: "dl-token-1"
      },
      {
        filename: "trace.log",
        contentType: null,
        sizeBytes: null,
        downloadToken: "dl-token-2"
      }
    ]);
  });

  it("uses subject and date fallbacks when values are absent", () => {
    const parsed = parseBrevoInboundPayload({
      messageId: "msg-fallback",
      from: "sender@example.com",
      to: ["recipient@inbound.example.com"]
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.subject).toBe("(no subject)");
    expect(typeof parsed?.receivedAt).toBe("string");
    expect(parsed?.receivedAt.endsWith("Z")).toBe(true);
    expect(parsed?.replyReferenceIds).toEqual([]);
  });

  it("parses Brevo wrapper payloads that contain items[]", () => {
    const parsed = parseBrevoInboundPayload({
      items: [
        {
          MessageId: "wrapped-001",
          From: "alerts@example.com",
          Recipients: ["ws-ff88a95da389@inbound.meowbert.example.com"],
          Subject: "Inbound webhook test",
          RawTextBody: "wrapped payload body",
          SentAtDate: "2026-03-06T08:05:00.000Z"
        }
      ]
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.messageId).toBe("wrapped-001");
    expect(parsed?.recipients).toEqual(["ws-ff88a95da389@inbound.meowbert.example.com"]);
    expect(parsed?.textBody).toBe("wrapped payload body");
    expect(parsed?.receivedAt).toBe("2026-03-06T08:05:00.000Z");
    expect(parsed?.replyReferenceIds).toEqual([]);
  });

  it("extracts reply reference ids from in-reply-to and references headers", () => {
    const parsed = parseBrevoInboundPayload({
      MessageId: "wrapped-002",
      From: "alerts@example.com",
      To: ["ws-ff88a95da389@inbound.meowbert.example.com"],
      InReplyTo: "<bot-message@example.com>",
      Headers: {
        References: "<original-1@example.com> <original-2@example.com>"
      }
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.replyReferenceIds).toEqual([
      "<bot-message@example.com>",
      "<original-1@example.com>",
      "<original-2@example.com>"
    ]);
  });

  it("parses sender/recipient mailbox objects from wrapped inbound payloads", () => {
    const parsed = parseBrevoInboundPayload({
      items: [
        {
          uuid: "evt-001",
          From: {
            Address: "sender@example.com",
            Name: "Sender"
          },
          recipient: {
            address: "ws-ff88a95da389@inbound.meowbert.example.com"
          },
          Subject: "Object mailbox payload",
          text: "hello from mailbox object"
        }
      ]
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.messageId).toBe("evt-001");
    expect(parsed?.fromEmail).toBe("sender@example.com");
    expect(parsed?.fromName).toBe("Sender");
    expect(parsed?.recipients).toEqual(["ws-ff88a95da389@inbound.meowbert.example.com"]);
    expect(parsed?.textBody).toBe("hello from mailbox object");
  });
});
