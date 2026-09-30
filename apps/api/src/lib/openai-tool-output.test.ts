import { describe, expect, it, vi } from "vitest";
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
  it("returns parsed tool output from the streamed terminal response", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "route_runtime_task",
          arguments: "{\"environment_id\":\"env_123\"}"
        }
      ]
    }));

    const result = await extractObjectWithToolCall<{ environment_id: string }>({
      client: {
        responses: {
          create: createMock
        }
      } as never,
      model: "gpt-test",
      toolName: "route_runtime_task",
      toolDescription: "Pick a runtime environment",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          environment_id: {
            type: "string"
          }
        },
        required: ["environment_id"]
      },
      input: [
        {
          role: "user",
          content: "run this"
        }
      ]
    });

    expect(result).toEqual({
      ok: true,
      value: {
        environment_id: "env_123"
      }
    });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-test",
        parallel_tool_calls: false,
        store: false,
        stream: true
      }),
      undefined
    );
  });

  it("returns the provider error from the final response", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: {
        message: "provider rejected request"
      },
      output: []
    }));

    const result = await extractObjectWithToolCall<{ environment_id: string }>({
      client: {
        responses: {
          create: createMock
        }
      } as never,
      model: "gpt-test",
      toolName: "route_runtime_task",
      toolDescription: "Pick a runtime environment",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          environment_id: {
            type: "string"
          }
        },
        required: ["environment_id"]
      },
      input: [
        {
          role: "user",
          content: "run this"
        }
      ]
    });

    expect(result).toEqual({
      ok: false,
      error: "provider rejected request"
    });
  });

  it("returns an error when the expected tool call is missing", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: []
    }));

    const result = await extractObjectWithToolCall<{ environment_id: string }>({
      client: {
        responses: {
          create: createMock
        }
      } as never,
      model: "gpt-test",
      toolName: "route_runtime_task",
      toolDescription: "Pick a runtime environment",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          environment_id: {
            type: "string"
          }
        },
        required: ["environment_id"]
      },
      input: [
        {
          role: "user",
          content: "run this"
        }
      ]
    });

    expect(result).toEqual({
      ok: false,
      error: "Model did not return the expected tool call output"
    });
  });

  it("returns an error when the streamed tool arguments are invalid JSON", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "route_runtime_task",
          arguments: "{\"environment_id\":"
        }
      ]
    }));

    const result = await extractObjectWithToolCall<{ environment_id: string }>({
      client: {
        responses: {
          create: createMock
        }
      } as never,
      model: "gpt-test",
      toolName: "route_runtime_task",
      toolDescription: "Pick a runtime environment",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          environment_id: {
            type: "string"
          }
        },
        required: ["environment_id"]
      },
      input: [
        {
          role: "user",
          content: "run this"
        }
      ]
    });

    expect(result).toEqual({
      ok: false,
      error: "Model returned invalid JSON tool arguments"
    });
  });
});
