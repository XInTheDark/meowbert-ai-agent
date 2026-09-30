import { describe, expect, it } from "vitest";
import {
  sanitizeContextUsagePayloadForDebugMode,
  sanitizeTaskEventPayloadForDebugMode,
  sanitizeTaskMessageForDebugMode
} from "./task-debug-visibility.js";

describe("sanitizeTaskMessageForDebugMode", () => {
  it("replaces detailed model retry errors with a generic retry message", () => {
    const message = {
      id: "message-1",
      role: "system",
      content_json: {
        text: "Model request failed (attempt 2/6): auth_unavailable: no auth available. Retrying in 8s..."
      }
    };

    expect(sanitizeTaskMessageForDebugMode(message, false)).toEqual({
      ...message,
      content_json: {
        text: "Model request failed (attempt 2/6): Something went wrong. Retrying in 8s..."
      }
    });
  });

  it("replaces detailed task failure messages with a generic failure message", () => {
    const message = {
      id: "message-2",
      role: "assistant",
      content_json: {
        text: "Task failed: 500 auth_unavailable: no auth available"
      }
    };

    expect(sanitizeTaskMessageForDebugMode(message, false)).toEqual({
      ...message,
      content_json: {
        text: "Something went wrong."
      }
    });
  });

  it("preserves message text when debug mode is enabled", () => {
    const message = {
      id: "message-3",
      role: "assistant",
      content_json: {
        text: "Task failed: boom"
      }
    };

    expect(sanitizeTaskMessageForDebugMode(message, true)).toEqual(message);
  });
});

describe("sanitizeContextUsagePayloadForDebugMode", () => {
  it("removes prompt revision and prefix hash when debug mode is disabled", () => {
    expect(
      sanitizeContextUsagePayloadForDebugMode({
        usedTokens: 12,
        promptRevision: "v3",
        prefixHash: "abc123",
        cacheHitRatio: 0.5
      }, false)
    ).toEqual({
      usedTokens: 12,
      cacheHitRatio: 0.5
    });
  });
});

describe("sanitizeTaskEventPayloadForDebugMode", () => {
  it("replaces raw error event messages when debug mode is disabled", () => {
    expect(
      sanitizeTaskEventPayloadForDebugMode("error", {
        message: "auth_unavailable: no auth available",
        runId: "run-1"
      }, false)
    ).toEqual({
      message: "Something went wrong.",
      runId: "run-1"
    });
  });

  it("removes advanced context usage fields from context events", () => {
    expect(
      sanitizeTaskEventPayloadForDebugMode("context_usage", {
        usedTokens: 12,
        promptRevision: "v3",
        prefixHash: "abc123"
      }, false)
    ).toEqual({
      usedTokens: 12
    });
  });

  it("removes detailed network diagnostics from log events when debug mode is disabled", () => {
    expect(
      sanitizeTaskEventPayloadForDebugMode("log", {
        message: "OpenAI SDK error: Could not parse message into JSON:",
        networkRequest: {
          phase: "debug",
          service: "openai_responses",
          endpoint: "responses.create",
          model: "gpt-5.4",
          baseUrl: "https://llm-proxy.example.com/v1",
          attempt: 2,
          errorResponse: {
            status: 500,
            requestId: "req_123",
            body: {
              error: {
                message: "not implemented"
              }
            }
          },
          request: {
            method: "POST",
            url: "https://llm-proxy.example.com/v1/responses",
            headers: {
              authorization: "Bearer secret"
            },
            body: {
              model: "gpt-5.4"
            }
          },
          responseStream: {
            events: [{ type: "response.output_text.delta", delta: "secret" }]
          },
          source: "openai_sdk",
          logLevel: "error",
          details: [
            "Could not parse message into JSON:",
            "data: {\"type\":\"response.completed\"",
            "event: message\ndata: {\"type\":\"response.completed\""
          ]
        }
      }, false)
    ).toEqual({
      message: "OpenAI SDK error: Could not parse message into JSON:",
      networkRequest: {
        phase: "debug",
        service: "openai_responses",
        endpoint: "responses.create",
        model: "gpt-5.4",
        baseUrl: "https://llm-proxy.example.com/v1",
        attempt: 2,
        source: "openai_sdk",
        logLevel: "error"
      }
    });
  });
});
