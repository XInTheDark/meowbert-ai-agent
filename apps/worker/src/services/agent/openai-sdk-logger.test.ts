import { describe, expect, it, vi } from "vitest";
import { withOpenAiRequestDebugLogging } from "./openai-sdk-logger.js";

describe("withOpenAiRequestDebugLogging", () => {
  it("forwards OpenAI SDK logs into structured network request debug events", async () => {
    const onNetworkRequest = vi.fn().mockResolvedValue(undefined);
    const debugClient = {
      responses: {
        create: vi.fn()
      }
    };
    const withOptions = vi.fn((options: {
      logLevel?: string;
      logger?: {
        error: (...args: unknown[]) => void;
      };
    }) => {
      expect(options.logLevel).toBe("debug");
      options.logger?.error(
        "Could not parse message into JSON:",
        "data: {\"type\":\"response.completed\"",
        "event: response.completed\ndata: {\"type\":\"response.completed\""
      );
      return debugClient;
    });

    const wrappedClient = withOpenAiRequestDebugLogging({
      withOptions
    } as never, {
      endpoint: "responses.create",
      model: "gpt-5.4",
      baseUrl: "https://llm-proxy.example.com/v1",
      attempt: 3,
      onNetworkRequest
    });

    expect(wrappedClient).toBe(debugClient);
    expect(withOptions).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => {
      expect(onNetworkRequest).toHaveBeenCalledWith(expect.objectContaining({
        phase: "debug",
        service: "openai_responses",
        endpoint: "responses.create",
        model: "gpt-5.4",
        baseUrl: "https://llm-proxy.example.com/v1",
        attempt: 3,
        source: "openai_sdk",
        logLevel: "error",
        message: "Could not parse message into JSON:",
        details: [
          "Could not parse message into JSON:",
          "data: {\"type\":\"response.completed\"",
          "event: response.completed\ndata: {\"type\":\"response.completed\""
        ]
      }));
    });
  });
});
