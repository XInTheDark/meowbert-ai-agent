import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../agent/openai-client.js", () => ({
  getOpenAiClient: vi.fn()
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn().mockResolvedValue(undefined)
}));

import { query } from "../../lib/db.js";
import { getOpenAiClient } from "../agent/openai-client.js";
import { emitTaskEvent } from "../runtime/events.js";
import {
  mapReasoningScoreToEffort,
  resolveModelRouterSelection
} from "./router-resolution.js";

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

describe("mapReasoningScoreToEffort", () => {
  it("maps scores onto low/medium/high/xhigh bands", () => {
    expect(mapReasoningScoreToEffort(0)).toBe("low");
    expect(mapReasoningScoreToEffort(24)).toBe("low");
    expect(mapReasoningScoreToEffort(25)).toBe("medium");
    expect(mapReasoningScoreToEffort(49)).toBe("medium");
    expect(mapReasoningScoreToEffort(50)).toBe("high");
    expect(mapReasoningScoreToEffort(74)).toBe("high");
    expect(mapReasoningScoreToEffort(75)).toBe("xhigh");
    expect(mapReasoningScoreToEffort(100)).toBe("xhigh");
  });
});

describe("resolveModelRouterSelection", () => {
  const mockedQuery = vi.mocked(query);
  const mockedGetOpenAiClient = vi.mocked(getOpenAiClient);
  const mockedEmitTaskEvent = vi.mocked(emitTaskEvent);

  const routers = [
    {
      id: "router-v1",
      routingModel: "gpt-router",
      defaultTargetModel: "fast",
      allowQuickMode: false,
      models: [
        {
          id: "deep",
          description: "Use for complex requests.",
          payload: {
            model: "gpt-5.4",
            responses: {
              text: {
                verbosity: "high"
              }
            }
          }
        },
        {
          id: "fast",
          description: "Use for quick requests.",
          payload: {
            model: "gpt-5.4-mini"
          }
        }
      ]
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses a cached router decision without calling the router model again", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          requested_model: "router-v1",
          router_id: "router-v1",
          routing_model: "gpt-router",
          resolved_model: "gpt-5.4",
          reasoning_score: 88,
          reason: "Hard request.",
          used_fallback: false,
          quick_mode: false
        }
      ],
      rowCount: 1
    } as never);

    const resolution = await resolveModelRouterSelection({
      taskId: "task-1",
      requestedModel: "router-v1",
      environmentPayload: {
        responses: {
          reasoning: {
            summary: "detailed"
          }
        }
      },
      platformModelRouters: routers,
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      branchMessageId: "msg-1",
      messages: [],
      requestTimeoutMs: 30_000
    });

    expect(resolution).toEqual({
      requestedModel: "router-v1",
      resolvedModel: "gpt-5.4",
      resolvedEnvironmentPayload: {
        responses: {
          reasoning: {
            effort: "xhigh",
            summary: "detailed"
          },
          text: {
            verbosity: "high"
          }
        }
      },
      routingModel: "gpt-router",
      reasoningScore: 88,
      reasoningEffort: "xhigh",
      reason: "Hard request.",
      usedFallback: false,
      cached: true,
      quickMode: false
    });
    expect(mockedGetOpenAiClient).not.toHaveBeenCalled();
    expect(mockedEmitTaskEvent).not.toHaveBeenCalled();
  });

  it("routes, persists, and emits a model_routed event for a fresh decision", async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            requested_model: "router-v1",
            router_id: "router-v1",
            routing_model: "gpt-router",
            resolved_model: "gpt-5.4",
            reasoning_score: 82,
            reason: "Complex task.",
            used_fallback: false,
            quick_mode: false
          }
        ],
        rowCount: 1
      } as never);
    const createMock = vi.fn().mockResolvedValue(createResponseStream({
      error: null,
      output: [
        {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          name: "select_runtime_model",
          arguments: JSON.stringify({
            modelId: "deep",
            reasoningScore: 82,
            reason: "Complex task.",
            quickMode: false
          })
        }
      ]
    }));
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: createMock
      }
    } as never);

    const resolution = await resolveModelRouterSelection({
      taskId: "task-1",
      requestedModel: "router-v1",
      environmentPayload: {
        responses: {
          reasoning: {
            summary: "detailed"
          }
        }
      },
      platformModelRouters: routers,
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      branchMessageId: "msg-1",
      taskInputDir: "/tmp/task-inputs",
      memoryMainFile: {
        path: "/workspace/.memory/MEMORY.md",
        content: "Workspace memory matters for routing.",
        truncated: false
      },
      projectMemoryMainFile: {
        path: "/workspace/.memory/projects/project/MEMORY.md",
        content: "Project memory mentions architecture reviews.",
        truncated: false
      },
      messages: [
        {
          id: "msg-1",
          role: "user",
          content_json: {
            text: "Please review this architecture carefully."
          },
          parent_message_id: null,
          edited_from_message_id: null,
          created_at: "2026-03-19T00:00:00.000Z"
        }
      ],
      requestTimeoutMs: 30_000
    });

    const request = createMock.mock.calls[0]?.[0] as { input?: Array<{ role?: string; content?: string }> };
    const userPayload = JSON.parse(request.input?.[1]?.content ?? "{}") as {
      decisionContext?: string;
      targetModels?: Array<Record<string, unknown>>;
      allowQuickMode?: boolean;
    };
    expect(userPayload.targetModels).toEqual([
      {
        id: "deep",
        description: "Use for complex requests."
      },
      {
        id: "fast",
        description: "Use for quick requests."
      }
    ]);
    expect(userPayload.allowQuickMode).toBe(false);
    expect(userPayload.decisionContext).toContain("Please review this architecture carefully.");
    expect(userPayload.decisionContext).toContain("Workspace memory matters for routing.");
    expect(userPayload.decisionContext).toContain("Project memory mentions architecture reviews.");
    expect(resolution).toEqual({
      requestedModel: "router-v1",
      resolvedModel: "gpt-5.4",
      resolvedEnvironmentPayload: {
        responses: {
          reasoning: {
            effort: "xhigh",
            summary: "detailed"
          },
          text: {
            verbosity: "high"
          }
        }
      },
      routingModel: "gpt-router",
      reasoningScore: 82,
      reasoningEffort: "xhigh",
      reason: "Complex task.",
      usedFallback: false,
      cached: false,
      quickMode: false
    });
    expect(mockedEmitTaskEvent).toHaveBeenCalledWith("task-1", "model_routed", {
      requestedModel: "router-v1",
      resolvedModel: "gpt-5.4",
      routingModel: "gpt-router",
      reasoningScore: 82,
      reasoningEffort: "xhigh",
      reason: "Complex task.",
      usedFallback: false,
      cached: false,
      quickMode: false
    });
  });

  it("falls back to the default target model when the router returns an invalid model", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0
    } as never);
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: vi.fn().mockResolvedValue(createResponseStream({
          error: null,
          output: [
            {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "select_runtime_model",
              arguments: JSON.stringify({
                modelId: "not-allowed",
                reasoningScore: 10,
                reason: "Bad selection.",
                quickMode: false
              })
            }
          ]
        }))
      }
    } as never);

    const resolution = await resolveModelRouterSelection({
      taskId: "task-1",
      requestedModel: "router-v1",
      environmentPayload: {},
      platformModelRouters: routers,
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      branchMessageId: null,
      messages: [],
      requestTimeoutMs: 30_000
    });

    expect(resolution).toEqual({
      requestedModel: "router-v1",
      resolvedModel: "gpt-5.4-mini",
      resolvedEnvironmentPayload: {
        responses: {
          reasoning: {
            effort: "low"
          }
        }
      },
      routingModel: "gpt-router",
      reasoningScore: 10,
      reasoningEffort: "low",
      reason: "Invalid model returned by router. Bad selection.",
      usedFallback: true,
      cached: false,
      quickMode: false
    });
    expect(mockedEmitTaskEvent).toHaveBeenCalledWith("task-1", "model_routed", {
      requestedModel: "router-v1",
      resolvedModel: "gpt-5.4-mini",
      routingModel: "gpt-router",
      reasoningScore: 10,
      reasoningEffort: "low",
      reason: "Invalid model returned by router. Bad selection.",
      usedFallback: true,
      cached: false,
      quickMode: false
    });
  });

  it("allows the router to choose Quick mode when enabled", async () => {
    mockedGetOpenAiClient.mockReturnValue({
      responses: {
        create: vi.fn().mockResolvedValue(createResponseStream({
          error: null,
          output: [
            {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "select_runtime_model",
              arguments: JSON.stringify({
                modelId: "fast",
                reasoningScore: 8,
                reason: "Direct chat answer.",
                quickMode: true
              })
            }
          ]
        }))
      }
    } as never);

    const resolution = await resolveModelRouterSelection({
      taskId: "task-1",
      requestedModel: "router-v1",
      environmentPayload: {},
      platformModelRouters: [{ ...routers[0], allowQuickMode: true }],
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      branchMessageId: null,
      messages: [],
      requestTimeoutMs: 30_000
    });

    expect(resolution?.resolvedModel).toBe("gpt-5.4-mini");
    expect(resolution?.quickMode).toBe(true);
    expect(mockedEmitTaskEvent).toHaveBeenCalledWith("task-1", "model_routed", expect.objectContaining({
      quickMode: true
    }));
  });
});
