import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractObjectWithToolCall } from "./openai-tool-output.js";

function createResponseStream(response: Record<string, unknown>): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        type: "response.completed",
        response
      };
    }
  };
}

describe("extractObjectWithToolCall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("retries transient failures and eventually returns parsed tool output", async () => {
    vi.useFakeTimers();

    const createMock = vi.fn()
      .mockRejectedValueOnce(new Error("408 stream error: stream disconnected before completion"))
      .mockResolvedValue(createResponseStream({
        error: null,
        output: [
          {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: "store_compacted_context",
            arguments: "{\"summary_markdown\":\"ok\"}"
          }
        ]
      }));
    const onRetry = vi.fn().mockResolvedValue(undefined);

    const extractionPromise = extractObjectWithToolCall<{ summary_markdown: string }>({
      client: {
        responses: {
          create: createMock
        }
      } as never,
      model: "gpt-test",
      toolName: "store_compacted_context",
      toolDescription: "Store compacted context",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary_markdown: {
            type: "string"
          }
        },
        required: ["summary_markdown"]
      },
      input: [
        {
          role: "user",
          content: "hello"
        }
      ],
      maxAttempts: 2,
      baseRetryDelayMs: 5000,
      onRetry
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 2,
        delayMs: 5000,
        error: expect.objectContaining({
          message: "408 stream error: stream disconnected before completion"
        })
      })
    );

    await vi.advanceTimersByTimeAsync(5000);

    await expect(extractionPromise).resolves.toEqual({
      ok: true,
      value: {
        summary_markdown: "ok"
      }
    });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("returns an error result after max attempts are exhausted", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: {
        message: "stream disconnected before completion"
      },
      output: []
    }));

    const extraction = await extractObjectWithToolCall<{ summary_markdown: string }>({
      client: {
        responses: {
          create: createMock
        }
      } as never,
      model: "gpt-test",
      toolName: "store_compacted_context",
      toolDescription: "Store compacted context",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary_markdown: {
            type: "string"
          }
        },
        required: ["summary_markdown"]
      },
      input: [
        {
          role: "user",
          content: "hello"
        }
      ],
      maxAttempts: 1
    });

    expect(extraction).toEqual({
      ok: false,
      error: "stream disconnected before completion"
    });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("aborts while waiting for a retry delay", async () => {
    vi.useFakeTimers();

    const createMock = vi.fn().mockRejectedValue(new Error("temporary upstream failure"));
    const controller = new AbortController();

    const extractionPromise = extractObjectWithToolCall<{ summary_markdown: string }>({
      client: {
        responses: {
          create: createMock
        }
      } as never,
      model: "gpt-test",
      toolName: "store_compacted_context",
      toolDescription: "Store compacted context",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary_markdown: {
            type: "string"
          }
        },
        required: ["summary_markdown"]
      },
      input: [
        {
          role: "user",
          content: "hello"
        }
      ],
      maxAttempts: 2,
      baseRetryDelayMs: 5000,
      abortSignal: controller.signal
    });

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(extractionPromise).rejects.toThrow("TASK_CANCELLED");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("treats a post-abort stream parse failure as cancellation instead of retrying", async () => {
    const controller = new AbortController();
    const createMock = vi.fn().mockImplementationOnce(() => {
      controller.abort(new Error("TASK_CANCELLED"));
      return Promise.reject(new SyntaxError("Unexpected end of JSON input"));
    });

    await expect(extractObjectWithToolCall<{ summary_markdown: string }>({
      client: {
        responses: {
          create: createMock
        }
      } as never,
      model: "gpt-test",
      toolName: "store_compacted_context",
      toolDescription: "Store compacted context",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary_markdown: {
            type: "string"
          }
        },
        required: ["summary_markdown"]
      },
      input: [
        {
          role: "user",
          content: "hello"
        }
      ],
      maxAttempts: 2,
      abortSignal: controller.signal
    })).rejects.toThrow("TASK_CANCELLED");

    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
