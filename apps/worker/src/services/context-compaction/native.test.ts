import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "openai/resources/responses/responses";
import { getOpenAiClient, type OpenAiProviderConfig } from "../agent/openai-client.js";
import { emitTaskEvent } from "../runtime/events.js";
import { compactWithNativeBackend } from "./native.js";
import {
  estimateTokensFromText,
  mapNativeCompactionOutputItemsToInputItems,
  NATIVE_COMPACTION_RETAINED_MESSAGE_TOKEN_BUDGET,
  providerSupportsNativeCompaction,
  type CompactContextInput,
  type ContextUsageSnapshot
} from "./shared.js";

vi.mock("../agent/openai-client.js", () => ({
  getOpenAiClient: vi.fn()
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn(async () => {})
}));

const usageBefore: ContextUsageSnapshot = {
  usedTokens: 1_000,
  maxContextTokens: 10_000,
  utilization: 0.1,
  source: "estimate",
  stage: "pre_model_call",
  step: 2
};

it("allows native compaction for an admin-selected custom endpoint", () => {
  const provider = { baseUrl: "https://custom.test/v1", apiKey: "key" };
  expect(providerSupportsNativeCompaction({ ...provider, supportsNativeCompaction: true })).toBe(true);
  expect(providerSupportsNativeCompaction(provider)).toBe(false);
});

function createCompactionResponse(): Response {
  return {
    id: "resp_v2_1",
    output: [
      {
        type: "compaction",
        id: "cmp_1",
        encrypted_content: "opaque-compacted-context"
      }
    ],
    usage: {
      input_tokens: 1_000,
      output_tokens: 100,
      total_tokens: 1_100
    }
  } as unknown as Response;
}

function createCompactionResponseWithHistoricalItems(): Response {
  return {
    id: "resp_v2_history",
    output: [
      {
        type: "message",
        id: "msg_user_1",
        role: "user",
        content: [{ type: "input_text", text: "Keep this user message." }]
      },
      {
        type: "message",
        id: "msg_system_1",
        role: "system",
        content: [{ type: "input_text", text: "Keep this system message." }]
      },
      {
        type: "message",
        id: "msg_developer_1",
        role: "developer",
        content: [{ type: "input_text", text: "Keep this developer message." }]
      },
      {
        type: "message",
        id: "msg_assistant_1",
        role: "assistant",
        content: [{ type: "output_text", text: "Do not replay this assistant message." }]
      },
      {
        type: "reasoning",
        id: "rs_1",
        summary: []
      },
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "run_shell",
        arguments: "{}"
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "Do not replay this tool output."
      },
      {
        type: "compaction",
        id: "cmp_1",
        encrypted_content: "opaque-compacted-context"
      }
    ],
    usage: {
      input_tokens: 1_000,
      output_tokens: 100,
      total_tokens: 1_100
    }
  } as unknown as Response;
}

function createResponseStream(response: Response): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "response.completed", response };
    }
  };
}

function createCompactInput(
  provider: OpenAiProviderConfig,
  conversationItems: CompactContextInput["conversationItems"] = [{ role: "user", content: "Compact this conversation." }]
): CompactContextInput {
  return {
    provider,
    taskId: "task-native-compaction",
    step: 2,
    trigger: "manual",
    model: "gpt-test",
    compactionBackend: "native",
    maxContextTokens: 10_000,
    systemPrompt: "system prompt",
    conversationItems,
    runPersistedItems: []
  };
}

function mockCompactionClient(): void {
  const create = vi.fn(async () => createResponseStream(createCompactionResponse()));
  vi.mocked(getOpenAiClient).mockReturnValue({
    responses: { create }
  } as unknown as ReturnType<typeof getOpenAiClient>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCompactionClient();
});

describe("compactWithNativeBackend Responses v2 routing", () => {
  it("uses the runtime provider and sends a compaction trigger over Responses", async () => {
    const provider: OpenAiProviderConfig = {
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1"
    };

    await compactWithNativeBackend({
      compactInput: createCompactInput(provider),
      usageBefore,
      requestedBackend: "native"
    });

    expect(getOpenAiClient).toHaveBeenCalledWith(provider);
    const client = vi.mocked(getOpenAiClient).mock.results[0]?.value as unknown as {
      responses: { create: ReturnType<typeof vi.fn> };
    };
    expect(client.responses.create).toHaveBeenCalledWith({
      model: "gpt-test",
      instructions: "system prompt",
      input: [
        { role: "user", content: "Compact this conversation." },
        { type: "compaction_trigger" }
      ],
      store: false,
      stream: true
    }, expect.anything());
  });

  it("preserves the runtime provider headers", async () => {
    const provider: OpenAiProviderConfig = {
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      defaultHeaders: { "X-Test": "preserved" }
    };

    await compactWithNativeBackend({
      compactInput: createCompactInput(provider),
      usageBefore,
      requestedBackend: "native"
    });

    expect(getOpenAiClient).toHaveBeenCalledWith(provider);
    expect(provider.apiKey).toBe("test-key");
    expect(provider.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("retains user, system, and developer messages plus compaction, but not prior assistant or tool state", async () => {
    const create = vi.fn(async () => createResponseStream(createCompactionResponseWithHistoricalItems()));
    vi.mocked(getOpenAiClient).mockReturnValue({
      responses: { create }
    } as unknown as ReturnType<typeof getOpenAiClient>);

    const result = await compactWithNativeBackend({
      compactInput: createCompactInput(
        { apiKey: "test-key", baseUrl: "https://api.openai.com/v1" },
        [
          { role: "user", content: "Compact this conversation." },
          { type: "compaction", encrypted_content: "old-compacted-context" }
        ]
      ),
      usageBefore,
      requestedBackend: "native"
    });

    expect(result.responseItems).toEqual([
      {
        type: "message",
        id: "msg_user_1",
        role: "user",
        content: [{ type: "input_text", text: "Keep this user message." }]
      },
      {
        type: "message",
        id: "msg_system_1",
        role: "system",
        content: [{ type: "input_text", text: "Keep this system message." }]
      },
      {
        type: "message",
        id: "msg_developer_1",
        role: "developer",
        content: [{ type: "input_text", text: "Keep this developer message." }]
      },
      {
        type: "compaction",
        id: "cmp_1",
        encrypted_content: "opaque-compacted-context"
      }
    ]);
    expect(result.nextItems).toEqual(result.responseItems);
    expect(JSON.stringify(result.nextItems)).not.toContain("old-compacted-context");
  });

  it("caps retained user messages from newest to oldest without budgeting system, developer, or compaction items", () => {
    const oldestText = "oldest ".repeat(NATIVE_COMPACTION_RETAINED_MESSAGE_TOKEN_BUDGET * 6);
    const newestText = "newest ".repeat(1_000);
    const systemText = "system ".repeat(NATIVE_COMPACTION_RETAINED_MESSAGE_TOKEN_BUDGET * 6);
    const output = [
      { type: "message", role: "user", content: oldestText },
      { type: "message", role: "system", content: systemText },
      { type: "message", role: "developer", content: "Keep this developer message." },
      { type: "message", role: "user", content: newestText },
      { type: "compaction", id: "cmp_new", encrypted_content: "opaque-compacted-context" }
    ] as unknown as Response["output"];

    const retained = mapNativeCompactionOutputItemsToInputItems(output);
    const userTexts = retained
      .filter((item) => "role" in item && item.role === "user")
      .map((item) => (item as { content: string }).content);

    expect(userTexts).toHaveLength(2);
    expect(userTexts[0].length).toBeLessThan(oldestText.length);
    expect(userTexts[1]).toBe(newestText);
    expect(userTexts.reduce((total, text) => total + estimateTokensFromText(text), 0))
      .toBeLessThanOrEqual(NATIVE_COMPACTION_RETAINED_MESSAGE_TOKEN_BUDGET);
    expect(retained).toContainEqual({ type: "message", role: "system", content: systemText });
    expect(retained).toContainEqual({ type: "message", role: "developer", content: "Keep this developer message." });
    expect(retained).toContainEqual({ type: "compaction", id: "cmp_new", encrypted_content: "opaque-compacted-context" });
  });
});
