import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:https", () => ({
  request: vi.fn()
}));

vi.mock("web-push", () => ({
  default: {
    generateRequestDetails: vi.fn()
  }
}));

import { request } from "node:https";
import webpush from "web-push";
import { sendCancellableWebPushRequest } from "./cancellable-web-push.js";

const mockedRequest = vi.mocked(request);
const mockedGenerateRequestDetails = vi.mocked(webpush.generateRequestDetails);

describe("cancellable-web-push", () => {
  const requestHandlers: Record<string, (value?: unknown) => void> = {};
  const responseHandlers: Record<string, (value?: unknown) => void> = {};
  const mockRequest = {
    destroy: vi.fn((error: Error) => requestHandlers.error?.(error)),
    end: vi.fn(),
    on: vi.fn((event: string, handler: (value?: unknown) => void) => {
      requestHandlers[event] = handler;
      return mockRequest;
    }),
    write: vi.fn()
  };
  const mockResponse = {
    on: vi.fn((event: string, handler: (value?: unknown) => void) => {
      responseHandlers[event] = handler;
      return mockResponse;
    }),
    setEncoding: vi.fn(),
    statusCode: 201
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(requestHandlers)) {
      delete requestHandlers[key];
    }
    for (const key of Object.keys(responseHandlers)) {
      delete responseHandlers[key];
    }
    mockedGenerateRequestDetails.mockReturnValue({
      body: Buffer.from("payload"),
      endpoint: "https://fcm.googleapis.com/subscription",
      headers: { "Content-Length": "7" },
      method: "POST"
    });
    mockedRequest.mockImplementation((_options, callback) => {
      callback(mockResponse as never);
      return mockRequest as never;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after a successful provider response", async () => {
    const pending = sendCancellableWebPushRequest(
      { endpoint: "https://fcm.googleapis.com/subscription", keys: { p256dh: "p256dh", auth: "auth" } },
      "payload",
      { subject: "mailto:ops@example.com", publicKey: "public", privateKey: "private" },
      10_000
    );

    responseHandlers.end?.();
    await expect(pending).resolves.toBeUndefined();
    expect(mockRequest.write).toHaveBeenCalledWith(Buffer.from("payload"));
    expect(mockRequest.end).toHaveBeenCalledOnce();
  });

  it("preserves provider status codes for expired subscriptions", async () => {
    mockResponse.statusCode = 410;
    const pending = sendCancellableWebPushRequest(
      { endpoint: "https://fcm.googleapis.com/subscription", keys: { p256dh: "p256dh", auth: "auth" } },
      "payload",
      { subject: "mailto:ops@example.com", publicKey: "public", privateKey: "private" },
      10_000
    );

    responseHandlers.end?.();
    await expect(pending).rejects.toMatchObject({ statusCode: 410 });
  });

  it("destroys requests that exceed the total deadline", async () => {
    vi.useFakeTimers();
    const pending = sendCancellableWebPushRequest(
      { endpoint: "https://fcm.googleapis.com/subscription", keys: { p256dh: "p256dh", auth: "auth" } },
      "payload",
      { subject: "mailto:ops@example.com", publicKey: "public", privateKey: "private" },
      1_000
    );

    const rejection = expect(pending).rejects.toThrow("timed out after 1000ms");
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(mockRequest.destroy).toHaveBeenCalledOnce();
  });
});
