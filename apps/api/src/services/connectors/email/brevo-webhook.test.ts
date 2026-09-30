import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBrevoInboundWebhookUrl, ensureBrevoInboundWebhook } from "./brevo-webhook.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

function getRequestUrl(callIndex: number): string {
  const call = fetchMock.mock.calls[callIndex];
  if (!call) {
    throw new Error(`Missing fetch call at index ${callIndex}`);
  }

  return String(call[0]);
}

function getRequestInit(callIndex: number): RequestInit | undefined {
  const call = fetchMock.mock.calls[callIndex];
  if (!call) {
    throw new Error(`Missing fetch call at index ${callIndex}`);
  }

  return call[1] as RequestInit | undefined;
}

function getJsonBody(callIndex: number): Record<string, unknown> {
  const body = getRequestInit(callIndex)?.body;
  if (typeof body !== "string") {
    throw new Error(`Expected JSON string body for fetch call ${callIndex}`);
  }

  return JSON.parse(body) as Record<string, unknown>;
}

describe("ensureBrevoInboundWebhook", () => {
  const apiKey = "xkeysib-test";
  const inboundDomain = "inbound.example.com";
  const webhookUrl = "https://api.example.com/api/connectors/email/inbound/brevo?token=abc";

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns existing when an exact webhook already exists", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        webhooks: [
          {
            id: 42,
            type: "inbound",
            url: webhookUrl,
            domain: inboundDomain,
            events: ["inboundEmailProcessed"],
            description: "Meowbert inbound email webhook"
          }
        ]
      })
    );

    const result = await ensureBrevoInboundWebhook({
      apiKey,
      inboundDomain,
      webhookUrl
    });

    expect(result).toEqual({
      action: "existing",
      webhook: {
        id: 42,
        type: "inbound",
        url: webhookUrl,
        domain: inboundDomain,
        events: ["inboundEmailProcessed"],
        description: "Meowbert inbound email webhook"
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getRequestUrl(0)).toBe("https://api.brevo.com/v3/webhooks?type=inbound");
    expect(getRequestInit(0)?.method).toBe("GET");
  });

  it("treats inbound list document_not_found as empty and creates webhook", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: "document_not_found",
            message: "Webhook record does not exist"
          },
          400
        )
      )
      .mockResolvedValueOnce(jsonResponse({ id: 89 }, 201));

    const result = await ensureBrevoInboundWebhook({
      apiKey,
      inboundDomain,
      webhookUrl
    });

    expect(result).toEqual({
      action: "created",
      webhook: {
        id: 89,
        type: "inbound",
        url: webhookUrl,
        domain: inboundDomain,
        events: ["inboundEmailProcessed"],
        description: "Meowbert inbound email webhook"
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getRequestInit(0)?.method).toBe("GET");
    expect(getRequestInit(1)?.method).toBe("POST");
  });

  it("creates a webhook when none exists and POST returns only an id", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ webhooks: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 88 }, 201));

    const result = await ensureBrevoInboundWebhook({
      apiKey,
      inboundDomain,
      webhookUrl
    });

    expect(result).toEqual({
      action: "created",
      webhook: {
        id: 88,
        type: "inbound",
        url: webhookUrl,
        domain: inboundDomain,
        events: ["inboundEmailProcessed"],
        description: "Meowbert inbound email webhook"
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getRequestUrl(1)).toBe("https://api.brevo.com/v3/webhooks");
    expect(getRequestInit(1)?.method).toBe("POST");
    expect(getJsonBody(1)).toEqual({
      type: "inbound",
      events: ["inboundEmailProcessed"],
      url: webhookUrl,
      domain: inboundDomain,
      description: "Meowbert inbound email webhook"
    });
  });

  it("updates an existing managed webhook and handles 204 no-content responses", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          webhooks: [
            {
              id: 10,
              type: "inbound",
              url: "https://api.example.com/api/connectors/email/inbound/brevo?token=old",
              domain: inboundDomain,
              events: ["inboundEmailProcessed"],
              description: "Meowbert inbound email webhook"
            }
          ]
        })
      )
      .mockResolvedValueOnce(emptyResponse(204));

    const result = await ensureBrevoInboundWebhook({
      apiKey,
      inboundDomain,
      webhookUrl
    });

    expect(result).toEqual({
      action: "updated",
      webhook: {
        id: 10,
        type: "inbound",
        url: webhookUrl,
        domain: inboundDomain,
        events: ["inboundEmailProcessed"],
        description: "Meowbert inbound email webhook"
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getRequestUrl(1)).toBe("https://api.brevo.com/v3/webhooks/10");
    expect(getRequestInit(1)?.method).toBe("PUT");
  });

  it("falls back to create when update target no longer exists", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          webhooks: [
            {
              id: 55,
              type: "inbound",
              url: "https://api.example.com/api/connectors/email/inbound/brevo?token=stale",
              domain: inboundDomain,
              events: ["inboundEmailProcessed"],
              description: "Meowbert inbound email webhook"
            }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ message: "Webhook record does not exist" }, 404))
      .mockResolvedValueOnce(jsonResponse({ id: 72 }, 201));

    const result = await ensureBrevoInboundWebhook({
      apiKey,
      inboundDomain,
      webhookUrl
    });

    expect(result).toEqual({
      action: "created",
      webhook: {
        id: 72,
        type: "inbound",
        url: webhookUrl,
        domain: inboundDomain,
        events: ["inboundEmailProcessed"],
        description: "Meowbert inbound email webhook"
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getRequestInit(0)?.method).toBe("GET");
    expect(getRequestInit(1)?.method).toBe("PUT");
    expect(getRequestInit(2)?.method).toBe("POST");
  });

  it("rethrows update errors that are not missing-record failures", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          webhooks: [
            {
              id: 12,
              type: "inbound",
              url: "https://api.example.com/api/connectors/email/inbound/brevo?token=old",
              domain: inboundDomain,
              events: ["inboundEmailProcessed"],
              description: "Meowbert inbound email webhook"
            }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));

    await expect(
      ensureBrevoInboundWebhook({
        apiKey,
        inboundDomain,
        webhookUrl
      })
    ).rejects.toThrowError("Unauthorized");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries with a refreshed list when create fails with missing-record error", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ webhooks: [] }))
      .mockResolvedValueOnce(jsonResponse({ message: "Webhook record does not exist" }, 404))
      .mockResolvedValueOnce(jsonResponse({ webhooks: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 91 }, 201));

    const result = await ensureBrevoInboundWebhook({
      apiKey,
      inboundDomain,
      webhookUrl
    });

    expect(result).toEqual({
      action: "created",
      webhook: {
        id: 91,
        type: "inbound",
        url: webhookUrl,
        domain: inboundDomain,
        events: ["inboundEmailProcessed"],
        description: "Meowbert inbound email webhook"
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(getRequestInit(0)?.method).toBe("GET");
    expect(getRequestInit(1)?.method).toBe("POST");
    expect(getRequestInit(2)?.method).toBe("GET");
    expect(getRequestInit(3)?.method).toBe("POST");
  });
});

describe("buildBrevoInboundWebhookUrl", () => {
  it("builds a Brevo inbound webhook URL with encoded token", () => {
    const url = buildBrevoInboundWebhookUrl({
      apiBaseUrl: "https://api.meowbert.company.com/",
      webhookSecret: "a token with spaces"
    });

    expect(url).toBe(
      "https://api.meowbert.company.com/api/connectors/email/inbound/brevo?token=a+token+with+spaces"
    );
  });

  it("throws when api base URL or token is missing", () => {
    expect(() =>
      buildBrevoInboundWebhookUrl({
        apiBaseUrl: "  ",
        webhookSecret: "token"
      })
    ).toThrowError("API base URL is required to build Brevo inbound webhook URL.");

    expect(() =>
      buildBrevoInboundWebhookUrl({
        apiBaseUrl: "https://api.example.com",
        webhookSecret: " "
      })
    ).toThrowError("Webhook secret is required to build Brevo inbound webhook URL.");
  });
});
