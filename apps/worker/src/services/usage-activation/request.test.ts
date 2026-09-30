import { afterEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { activationErrorMessage, sendActivationRequest } from "./request.js";

const provider = { baseUrl: "https://activation.test/v1", apiKey: "test-secret" };
afterEach(() => { vi.unstubAllGlobals(); });
function mockEvents(events: object[]) {
  const data = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  const mock = vi.fn().mockImplementation(async () => new Response(data, { headers: { "content-type": "text/event-stream" } }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("activation request", () => {
  it("uses the configured provider and raw model with a bounded tool-free request", async () => {
    const fetch = mockEvents([{ type: "response.completed", response: { status: "completed" } }]);
    await sendActivationRequest(provider, "model-a");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://activation.test/v1/responses");
    expect(JSON.parse(init.body)).toEqual({ model: "model-a", input: "Reply with OK.", max_output_tokens: 128, store: false, stream: true });
  });
  it("counts a token-limited response as usage and rejects failures or truncated streams", async () => {
    mockEvents([{ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }]);
    await expect(sendActivationRequest(provider, "reasoning-model")).resolves.toBeUndefined();
    mockEvents([{ type: "response.failed" }]);
    await expect(sendActivationRequest(provider, "model-a")).rejects.toThrow();
    mockEvents([{ type: "response.created" }]);
    await expect(sendActivationRequest(provider, "model-a")).rejects.toThrow("missing_result");
  });
  it("does not retry provider errors or expose provider bodies", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: { message: "test-secret private body" } }),
      { status: 429, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const error = await sendActivationRequest(provider, "model-a").catch((error) => error);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(activationErrorMessage(error)).toBe("Provider returned HTTP 429.");
    expect(activationErrorMessage(new Error("test-secret"))).not.toContain("test-secret");
    expect(activationErrorMessage(new OpenAI.APIConnectionTimeoutError())).toContain("30 seconds");
  });
});
