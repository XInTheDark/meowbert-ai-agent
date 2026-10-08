import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./openai-client.js", () => ({
  getOpenAiClient: vi.fn()
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../lib/db.js", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
}));

vi.mock("../../lib/config.js", () => ({
  config: {
    openai: {
      baseUrl: "https://example.com/v1",
      defaultModel: "gpt-default",
      fastModel: "gpt-fast"
    }
  }
}));

import { getOpenAiClient } from "./openai-client.js";
import { emitTaskEvent } from "../runtime/events.js";
import { query } from "../../lib/db.js";
import { createModelResponse, createModelResponseWithRetry, maybeAutoGenerateTaskTitle } from "./model.js";

describe("createModelResponse", () => {
  const mockedGetOpenAiClient = vi.mocked(getOpenAiClient);
  const mockedEmitTaskEvent = vi.mocked(emitTaskEvent);
  const mockedQuery = vi.mocked(query);

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

  beforeEach(() => {
    vi.clearAllMocks();
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    vi.useRealTimers();
  });

  it("uses 5-minute default timeout and disables SDK retries", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      prefixItems: [
        {
          role: "developer",
          content: "Return ok"
        }
      ],
      conversationItems: [],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        maxRetries: 0,
        timeout: 300_000
      })
    );
  });

  it("rejects a partial streamed function call without a call_id", async () => {
    const createMock = vi.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "function_call", id: "fc_incomplete", name: "run_shell", arguments: "{}" }
        };
      }
    });
    mockedGetOpenAiClient.mockReturnValue({ responses: { create: createMock } } as never);

    await expect(createModelResponse({
      provider: { apiKey: "test", baseUrl: "https://example.com/v1" },
      model: "gpt-test",
      prefixItems: [],
      conversationItems: [],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    })).rejects.toThrow("Model response contained a function call without a call_id.");
  });

  it("sends prefix items before conversation items", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      prefixItems: [
        {
          role: "developer",
          content: "Use dollar math delimiters only."
        }
      ],
      conversationItems: [
        {
          role: "user",
          content: "show me equations"
        }
      ],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const request = createMock.mock.calls[0]?.[0] as { input?: Array<{ role?: string; content?: unknown }>; instructions?: unknown };
    expect(request.instructions).toBeUndefined();
    expect(request.input?.[0]).toEqual({
      role: "developer",
      content: "Use dollar math delimiters only."
    });
    expect(request.input?.[1]).toEqual({
      role: "user",
      content: "show me equations"
    });
  });

  it("converts system and developer messages to user messages for noSystemMessages models", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "compat-test",
      compatibilityModes: ["noSystemMessages"],
      prefixItems: [
        {
          role: "developer",
          content: "Follow the run policy."
        },
        {
          role: "system",
          content: "Internal retry metadata."
        }
      ],
      conversationItems: [
        {
          role: "user",
          content: "show me equations"
        }
      ],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    });

    const request = createMock.mock.calls[0]?.[0] as { input?: Array<{ role?: string; content?: unknown }> };
    expect(request.input).toEqual([
      {
        role: "user",
        content: "Follow the run policy."
      },
      {
        role: "user",
        content: "Internal retry metadata."
      },
      {
        role: "user",
        content: "show me equations"
      }
    ]);
  });

  it("converts developer messages to system messages for noDeveloperMessages models", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "compat-test",
      compatibilityModes: ["noDeveloperMessages"],
      prefixItems: [
        {
          role: "developer",
          content: "Follow the run policy."
        },
        {
          role: "system",
          content: "Keep this as a system message."
        }
      ],
      conversationItems: [
        {
          role: "user",
          content: "show me equations"
        }
      ],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    });

    const request = createMock.mock.calls[0]?.[0] as { input?: Array<{ role?: string; content?: unknown }> };
    expect(request.input).toEqual([
      {
        role: "system",
        content: "Follow the run policy."
      },
      {
        role: "system",
        content: "Keep this as a system message."
      },
      {
        role: "user",
        content: "show me equations"
      }
    ]);
  });

  it("keeps OpenAI request input order unchanged", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    const functionCall = {
      type: "function_call",
      call_id: "call_1",
      name: "view_image",
      arguments: "{}"
    } as const;
    const observation = {
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/png;base64,abc" }]
    } as const;
    const functionOutput = {
      type: "function_call_output",
      call_id: "call_1",
      output: "{\"ok\":true}"
    } as const;

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      modelType: "openai",
      prefixItems: [],
      conversationItems: [
        functionCall,
        observation as never,
        functionOutput
      ],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    });

    const request = createMock.mock.calls[0]?.[0] as { input?: unknown[] };
    expect(request.input).toEqual([
      functionCall,
      observation,
      functionOutput
    ]);
  });

  it("moves Google tool outputs immediately after matching tool calls", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    const functionCall = {
      type: "function_call",
      call_id: "call_1",
      name: "view_image",
      arguments: "{}"
    } as const;
    const observation = {
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/png;base64,abc" }]
    } as const;
    const functionOutput = {
      type: "function_call_output",
      call_id: "call_1",
      output: "{\"ok\":true}"
    } as const;
    const nextUserMessage = {
      role: "user",
      content: "continue"
    } as const;

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gemini-test",
      modelType: "google",
      prefixItems: [],
      conversationItems: [
        functionCall,
        observation as never,
        functionOutput,
        nextUserMessage
      ],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    });

    const request = createMock.mock.calls[0]?.[0] as { input?: unknown[] };
    expect(request.input).toEqual([
      functionCall,
      functionOutput,
      observation,
      nextUserMessage
    ]);
  });

  it("normalizes Google request tools away from OpenAI-only custom and schema shapes", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gemini-test",
      modelType: "google",
      prefixItems: [],
      conversationItems: [
        {
          role: "user",
          content: "make slides"
        }
      ],
      modelPayload: {},
      tools: [
        {
          type: "custom",
          name: "apply_patch",
          description: "Apply patches.",
          format: {
            type: "grammar",
            syntax: "lark",
            definition: "start: /.+/"
          }
        } as never,
        {
          type: "function",
          name: "html_canvas__html_canvas_render",
          description: "Render HTML.",
          strict: false,
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              title: {
                anyOf: [
                  { type: "string", minLength: 1 },
                  { type: "null" }
                ],
                description: "Optional title."
              }
            },
            required: [],
            additionalProperties: false
          }
        } as never
      ],
      toolChoice: "auto"
    });

    const request = createMock.mock.calls[0]?.[0] as { tools?: Array<Record<string, unknown>> };
    expect(request.tools?.some((tool) => tool.type === "custom")).toBe(false);
    expect(request.tools).toContainEqual(expect.objectContaining({
      type: "function",
      name: "apply_patch",
      strict: true
    }));

    const renderTool = request.tools?.find((tool) => tool.name === "html_canvas__html_canvas_render") as
      | { parameters?: { properties?: { title?: { type?: unknown[] } } } }
      | undefined;
    expect(JSON.stringify(renderTool?.parameters)).not.toContain("$schema");
    expect(JSON.stringify(renderTool?.parameters)).not.toContain("anyOf");
    expect(renderTool?.parameters?.properties?.title?.type).toEqual(["string", "null"]);
  });

  it("sorts tools for deterministic request envelopes", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      prefixItems: [
        {
          role: "developer",
          content: "Return ok"
        }
      ],
      conversationItems: [],
      modelPayload: {},
      tools: [
        {
          type: "web_search",
          search_context_size: "high"
        } as never,
        {
          type: "function",
          name: "zeta_tool",
          description: "zeta",
          strict: true,
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false
          }
        } as never,
        {
          type: "function",
          name: "alpha_tool",
          description: "alpha",
          strict: true,
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false
          }
        } as never
      ],
      toolChoice: "auto"
    });

    const request = createMock.mock.calls[0]?.[0] as {
      tools?: Array<{ type?: string; name?: string }>;
    };
    expect(request.tools?.map((tool) => `${tool.type}:${tool.name ?? ""}`)).toEqual([
      "function:alpha_tool",
      "function:zeta_tool",
      "web_search:"
    ]);
  });

  it("uses workspace-configured timeout when provided", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      requestTimeoutMs: 45_000,
      prefixItems: [
        {
          role: "developer",
          content: "Return ok"
        }
      ],
      conversationItems: [],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        maxRetries: 0,
        timeout: 45_000
      })
    );
  });

  it("forwards abort signal so in-flight model requests can be interrupted", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    const controller = new AbortController();
    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      requestTimeoutMs: 45_000,
      abortSignal: controller.signal,
      prefixItems: [
        {
          role: "developer",
          content: "Return ok"
        }
      ],
      conversationItems: [],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        signal: controller.signal
      })
    );
  });

  it("forwards prompt cache routing and TTL fields for cache bucketing", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      cacheUserId: "user-123",
      promptCacheKey: "task:abc",
      promptCacheTtl: "30m",
      prefixItems: [
        {
          role: "developer",
          content: "Return ok"
        }
      ],
      conversationItems: [],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    });

    const request = createMock.mock.calls[0]?.[0] as {
      user?: string;
      prompt_cache_key?: string;
      prompt_cache_options?: {
        ttl?: string;
      };
    };
    expect(request.user).toBe("user-123");
    expect(request.prompt_cache_key).toBe("task:abc");
    expect(request.prompt_cache_options).toEqual({ ttl: "30m" });
    expect(request).not.toHaveProperty("prompt_cache_retention");
  });

  it("sends the prompt cache key as the session affinity header", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);
    const baseInput = {
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "claude-test",
      prefixItems: [],
      conversationItems: [],
      modelPayload: {},
      tools: [],
      toolChoice: "auto" as const
    };

    await createModelResponse({ ...baseInput, promptCacheKey: "task:abc" });
    await createModelResponse(baseInput);

    const keyedOptions = createMock.mock.calls[0]?.[1] as { headers?: Record<string, string> };
    const unkeyedOptions = createMock.mock.calls[1]?.[1] as { headers?: Record<string, string> };
    expect(keyedOptions.headers).toEqual({ "x-session-affinity": "task:abc" });
    expect(unkeyedOptions.headers).toBeUndefined();
  });

  it("asks Meridian to keep a keyed session's cache warm", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);
    const baseInput = {
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "claude-test",
      prefixItems: [],
      conversationItems: [],
      modelPayload: {},
      tools: [],
      toolChoice: "auto" as const,
      cacheKeepaliveSeconds: 1800
    };

    await createModelResponse({ ...baseInput, promptCacheKey: "task:abc" });
    await createModelResponse(baseInput);

    const keyedOptions = createMock.mock.calls[0]?.[1] as { headers?: Record<string, string> };
    const unkeyedOptions = createMock.mock.calls[1]?.[1] as { headers?: Record<string, string> };
    expect(keyedOptions.headers).toEqual({
      "x-session-affinity": "task:abc",
      "x-meridian-cache-keepalive": "1800"
    });
    expect(unkeyedOptions.headers).toBeUndefined();
  });

  it("omits prompt cache options when no TTL is configured", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      cacheUserId: "user-123",
      promptCacheKey: "task:abc",
      prefixItems: [
        {
          role: "developer",
          content: "Return ok"
        }
      ],
      conversationItems: [],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    });

    const request = createMock.mock.calls[0]?.[0] as {
      prompt_cache_key?: string;
      prompt_cache_options?: {
        ttl?: string;
      };
    };
    expect(request.prompt_cache_key).toBe("task:abc");
    expect("prompt_cache_options" in request).toBe(false);
    expect(request.prompt_cache_options).toBeUndefined();
  });

  it("uses bounded decision context for task title generation", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "set_task_title",
          arguments: JSON.stringify({
            title: "Architecture Review"
          })
        }
      ],
      output_text: ""
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await maybeAutoGenerateTaskTitle({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      taskId: "task-1",
      currentTitle: "New Task",
      source: "web",
      messages: [
        {
          id: "msg-1",
          role: "user",
          content_json: {
            text: "Please review this architecture carefully.",
            attachments: [
              {
                kind: "note",
                label: "Note",
                content: "Focus on router context.",
                sizeBytes: null
              }
            ]
          },
          parent_message_id: null,
          edited_from_message_id: null,
          created_at: "2026-05-05T00:00:00.000Z"
        }
      ],
      memoryMainFile: {
        path: "/workspace/.memory/MEMORY.md",
        content: "Workspace memory mentions title generation.",
        truncated: false
      },
      projectMemoryMainFile: {
        path: "/workspace/.memory/projects/project/MEMORY.md",
        content: "Project memory mentions model routing.",
        truncated: false
      },
      model: "gpt-title"
    });

    const request = createMock.mock.calls[0]?.[0] as { input?: Array<{ role?: string; content?: string }> };
    const titlePrompt = request.input?.[1]?.content ?? "";
    expect(titlePrompt).toContain("Please review this architecture carefully.");
    expect(titlePrompt).toContain("Focus on router context.");
    expect(titlePrompt).toContain("Workspace memory mentions title generation.");
    expect(titlePrompt).toContain("Project memory mentions model routing.");
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE tasks"), ["task-1", "Architecture Review"]);
  });

  it("throws a descriptive error when the provider returns response.error", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: {
        message: "provider rejected request"
      },
      output: [],
      output_text: ""
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await expect(
      createModelResponse({
        provider: {
          apiKey: "test",
          baseUrl: "https://example.com/v1"
        },
        model: "gpt-test",
        prefixItems: [
          {
            role: "developer",
            content: "Return ok"
          }
        ],
        conversationItems: [],
        modelPayload: {},
        tools: [],
        toolChoice: "auto"
      })
    ).rejects.toThrow("provider rejected request");
  });

  it("emits a replayable request payload when network request logging is enabled", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    const onNetworkRequest = vi.fn().mockResolvedValue(undefined);

    await createModelResponseWithRetry("task-123", {
      provider: {
        apiKey: "test-secret",
        baseUrl: "https://example.com/v1",
        defaultHeaders: {
          originator: "codex_cli_rs"
        }
      },
      model: "gpt-test",
      compatibilityModes: ["noSystemMessages"],
      cacheUserId: "user-123",
      promptCacheKey: "task:abc",
      promptCacheTtl: "30m",
      prefixItems: [
        {
          role: "developer",
          content: "Return ok"
        }
      ],
      conversationItems: [
        {
          role: "user",
          content: "hello"
        }
      ],
      modelPayload: {
        temperature: 0.2
      },
      tools: [],
      toolChoice: "auto",
      onNetworkRequest
    });

    expect(onNetworkRequest).toHaveBeenCalledWith(expect.objectContaining({
      phase: "start",
      endpoint: "responses.create",
      request: expect.objectContaining({
        method: "POST",
        url: "https://example.com/v1/responses",
        headers: expect.objectContaining({
          authorization: "Bearer <REPLACE_WITH_API_KEY>",
          "content-type": "application/json",
          accept: "text/event-stream",
          originator: "codex_cli_rs"
        }),
        body: expect.objectContaining({
          model: "gpt-test",
          input: [
            {
              role: "user",
              content: "Return ok"
            },
            {
              role: "user",
              content: "hello"
            }
          ],
          stream: true,
          prompt_cache_key: "task:abc",
          prompt_cache_options: {
            ttl: "30m"
          },
          user: "user-123",
          temperature: 0.2
        }),
        curl: expect.stringContaining("https://example.com/v1/responses")
      })
    }));
    const event = onNetworkRequest.mock.calls[0]?.[0];
    expect(event.request.curl).toContain("curl \\\n  'https://example.com/v1/responses' \\\n  -X POST \\");
  });

  it("uses the ChatGPT Codex request shape for subscription providers", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    const onNetworkRequest = vi.fn().mockResolvedValue(undefined);

    await createModelResponseWithRetry("task-123", {
      provider: {
        apiKey: "test-secret",
        baseUrl: "https://chatgpt.com/backend-api/codex",
        defaultHeaders: {
          originator: "meowbert",
          "ChatGPT-Account-ID": "acct-123"
        },
        chatGptCodex: true
      },
      model: "gpt-5.4",
      cacheUserId: "user-123",
      promptCacheKey: "task:abc",
      promptCacheTtl: "30m",
      prefixItems: [
        {
          role: "developer",
          content: "Follow the task instructions."
        },
        {
          role: "system",
          content: "Use the available tools when needed."
        }
      ],
      conversationItems: [
        {
          role: "user",
          content: "hello"
        }
      ],
      modelPayload: {},
      tools: [],
      toolChoice: "auto",
      onNetworkRequest
    });

    const request = onNetworkRequest.mock.calls[0]?.[0]?.request;
    expect(request.headers).toEqual(expect.objectContaining({
      originator: "meowbert",
      "ChatGPT-Account-ID": "acct-123",
      "session-id": "task-123",
      "x-client-request-id": "task-123"
    }));
    expect(request.body).toEqual(expect.objectContaining({
      instructions: "Follow the task instructions.\n\nUse the available tools when needed.",
      input: [{ role: "user", content: "hello" }],
      prompt_cache_key: "task:abc"
    }));
    expect(request.body).not.toHaveProperty("prompt_cache_options");
    expect(request.body).not.toHaveProperty("user");
    expect(mockedGetOpenAiClient).toHaveBeenCalledWith(expect.objectContaining({
      defaultHeaders: expect.objectContaining({
        "session-id": "task-123",
        "x-client-request-id": "task-123"
      })
    }));
  });

  it("emits the full provider error response on failed network attempts", async () => {
    vi.useFakeTimers();

    const providerError = Object.assign(new Error("500 not implemented (request id: req_123)"), {
      status: 500,
      requestID: "req_123",
      headers: new Headers({
        "x-request-id": "req_123",
        "set-cookie": "session=secret"
      }),
      error: {
        message: "not implemented",
        type: "server_error",
        provider_trace: {
          upstream: "model-gateway",
          raw: {
            detail: "full body detail"
          }
        }
      }
    });
    const createMock = vi.fn()
      .mockRejectedValueOnce(providerError)
      .mockResolvedValue(createResponseStream({
        error: null,
        output: [],
        output_text: "ok"
      }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    const onNetworkRequest = vi.fn().mockResolvedValue(undefined);
    const responsePromise = createModelResponseWithRetry("task-123", {
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      prefixItems: [
        {
          role: "developer",
          content: "Return ok"
        }
      ],
      conversationItems: [],
      modelPayload: {},
      tools: [],
      toolChoice: "auto",
      onNetworkRequest
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(onNetworkRequest).toHaveBeenCalledWith(expect.objectContaining({
      phase: "error",
      endpoint: "responses.create",
      error: "500 not implemented (request id: req_123)",
      errorResponse: {
        status: 500,
        requestId: "req_123",
        headers: {
          "set-cookie": "***",
          "x-request-id": "req_123"
        },
        body: {
          error: {
            message: "not implemented",
            type: "server_error",
            provider_trace: {
              upstream: "model-gateway",
              raw: {
                detail: "full body detail"
              }
            }
          }
        }
      }
    }));

    await vi.advanceTimersByTimeAsync(15_000);
    await expect(responsePromise).resolves.toEqual({
      error: null,
      output: [],
      output_text: "ok"
    });
  });

  it("waits longer between retries and surfaces the retry notice", async () => {
    vi.useFakeTimers();

    const createMock = vi.fn()
      .mockRejectedValueOnce(new Error("auth_unavailable: no auth available"))
      .mockResolvedValue(createResponseStream({
        error: null,
        output: [],
        output_text: "ok"
      }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    const onRetryMessage = vi.fn().mockResolvedValue(undefined);
    const responsePromise = createModelResponseWithRetry(
      "task-123",
      {
        provider: {
          apiKey: "test",
          baseUrl: "https://example.com/v1"
        },
        model: "gpt-test",
        prefixItems: [
          {
            role: "developer",
            content: "Return ok"
          }
        ],
        conversationItems: [],
        modelPayload: {},
        tools: [],
        toolChoice: "auto"
      },
      onRetryMessage
    );

    await vi.advanceTimersByTimeAsync(0);

    expect(onRetryMessage).toHaveBeenCalledWith(
      "Model request failed (attempt 1/6): auth_unavailable: no auth available. Retrying in 15s..."
    );
    expect(mockedEmitTaskEvent).toHaveBeenCalledWith("task-123", "error", {
      message: "Model request failed (attempt 1/6): auth_unavailable: no auth available. Retrying in 15s...",
      attempt: 1,
      maxAttempts: 6,
      retrying: true
    });

    await vi.advanceTimersByTimeAsync(15_000);

    await expect(responsePromise).resolves.toEqual({
      error: null,
      output: [],
      output_text: "ok"
    });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("repairs request input after three consecutive errors before retrying", async () => {
    vi.useFakeTimers();

    const requestError = new Error("400 image data is invalid");
    const createMock = vi.fn()
      .mockRejectedValueOnce(requestError)
      .mockRejectedValueOnce(requestError)
      .mockRejectedValueOnce(requestError)
      .mockResolvedValue(createResponseStream({
        error: null,
        output: [],
        output_text: "ok"
      }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    const conversationItems = [{ role: "user", content: "invalid image data" }];
    const onConsecutiveErrorRecovery = vi.fn(async () => {
      conversationItems[0] = { role: "system", content: "image omitted after provider error" };
      return true;
    });
    const responsePromise = createModelResponseWithRetry("task-123", {
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      prefixItems: [],
      conversationItems,
      modelPayload: {},
      tools: [],
      toolChoice: "auto",
      onConsecutiveErrorRecovery
    });

    await vi.advanceTimersByTimeAsync(45_000);

    await expect(responsePromise).resolves.toEqual({
      error: null,
      output: [],
      output_text: "ok"
    });
    expect(onConsecutiveErrorRecovery).toHaveBeenCalledTimes(1);
    expect(onConsecutiveErrorRecovery).toHaveBeenCalledWith("400 image data is invalid");
    expect(createMock).toHaveBeenCalledTimes(4);
    expect(createMock.mock.calls[3][0].input).toEqual([
      { role: "system", content: "image omitted after provider error" }
    ]);
  });

  it("recovers immediately on missing tool output error without waiting for error threshold", async () => {
    const createMock = vi.fn()
      .mockRejectedValueOnce(new Error("400 No tool output found for function call call_abc."))
      .mockResolvedValueOnce(createResponseStream({
        error: null,
        output: [],
        output_text: "ok"
      }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    const conversationItems = [
      { type: "function_call", call_id: "call_abc", name: "tool1", arguments: "{}" }
    ] as never[];
    const onConsecutiveErrorRecovery = vi.fn(async () => {
      conversationItems.push({
        type: "function_call_output",
        call_id: "call_abc",
        output: "system: an error occurred"
      } as never);
      return true;
    });

    const responsePromise = createModelResponseWithRetry("task-123", {
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      prefixItems: [],
      conversationItems,
      modelPayload: {},
      tools: [],
      toolChoice: "auto",
      onConsecutiveErrorRecovery
    });

    await expect(responsePromise).resolves.toEqual({
      error: null,
      output: [],
      output_text: "ok"
    });
    expect(onConsecutiveErrorRecovery).toHaveBeenCalledTimes(1);
    expect(onConsecutiveErrorRecovery).toHaveBeenCalledWith("400 No tool output found for function call call_abc.");
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry unchanged requests after a context-window rejection", async () => {
    const createMock = vi.fn().mockRejectedValue(new Error(
      "Your input exceeds the context window of this model. Please adjust your input and try again."
    ));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await expect(createModelResponseWithRetry("task-123", {
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      prefixItems: [
        {
          role: "developer",
          content: "Return ok"
        }
      ],
      conversationItems: [],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    })).rejects.toThrow("Your input exceeds the context window of this model.");

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(mockedEmitTaskEvent).not.toHaveBeenCalledWith("task-123", "error", expect.objectContaining({
      retrying: true
    }));
  });

  it("stops retrying when a stream failure arrives after the task abort signal is set", async () => {
    const controller = new AbortController();
    const createMock = vi.fn().mockImplementationOnce(() => {
      controller.abort(new Error("TASK_CANCELLED"));
      return Promise.reject(new SyntaxError("Unexpected end of JSON input"));
    });
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await expect(createModelResponseWithRetry(
      "task-123",
      {
        provider: {
          apiKey: "test",
          baseUrl: "https://example.com/v1"
        },
        model: "gpt-test",
        abortSignal: controller.signal,
        prefixItems: [
          {
            role: "developer",
            content: "Return ok"
          }
        ],
        conversationItems: [],
        modelPayload: {},
        tools: [],
        toolChoice: "auto"
      }
    )).rejects.toThrow("TASK_CANCELLED");

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(mockedEmitTaskEvent).not.toHaveBeenCalledWith("task-123", "error", expect.objectContaining({
      retrying: true
    }));
  });

  it("enables parallel_tool_calls by default in model requests", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      prefixItems: [
        {
          role: "developer",
          content: "Return ok"
        }
      ],
      conversationItems: [],
      modelPayload: {},
      tools: [],
      toolChoice: "auto"
    });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parallel_tool_calls: true
      }),
      expect.any(Object)
    );
  });

  it("respects explicit parallelToolCalls input and modelPayload overrides", async () => {
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [],
      output_text: "ok"
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      prefixItems: [{ role: "developer", content: "Return ok" }],
      conversationItems: [],
      modelPayload: {},
      tools: [],
      toolChoice: "auto",
      parallelToolCalls: false
    });

    expect(createMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        parallel_tool_calls: false
      }),
      expect.any(Object)
    );

    await createModelResponse({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      model: "gpt-test",
      prefixItems: [{ role: "developer", content: "Return ok" }],
      conversationItems: [],
      modelPayload: { parallel_tool_calls: false },
      tools: [],
      toolChoice: "auto"
    });

    expect(createMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        parallel_tool_calls: false
      }),
      expect.any(Object)
    );
  });
});
