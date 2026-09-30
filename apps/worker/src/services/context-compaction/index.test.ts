import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses";

vi.mock("../agent-db/index.js", () => ({
  appendMessage: vi.fn(async () => "compaction-marker-1")
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn(async () => {}),
  publishTaskEvent: vi.fn(async () => {})
}));

vi.mock("../../lib/openai-tool-output.js", () => ({
  extractObjectWithToolCall: vi.fn(async () => ({
    ok: false,
    error: "summary model rejected the reduced compaction input"
  }))
}));

vi.mock("./native.js", () => ({
  compactWithNativeBackend: vi.fn()
}));

import { appendMessage } from "../agent-db/index.js";
import { emitTaskEvent } from "../runtime/events.js";
import { extractObjectWithToolCall } from "../../lib/openai-tool-output.js";
import { compactWithNativeBackend } from "./native.js";
import {
  compactContextNow,
  estimateContextTokens,
  maybeAutoCompactContext,
  normalizeCompactionLiveTailStartIndex,
  prepareConversationHistoryChunksForCompaction,
  recoverContextAfterContextWindowError,
  selectCompactionLiveTailItems
} from "./index.js";
import { stringifyContextEstimateValue } from "./token-estimation.js";

function createPngDataUrl(width: number, height: number): string {
  const header = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return `data:image/png;base64,${header.toString("base64")}`;
}

function buildImageInputItem(input: { imageUrl: string; detail?: "low" | "high" | "auto" }): ResponseInputItem {
  return {
    role: "user",
    content: [
      {
        type: "input_image",
        detail: input.detail ?? "high",
        image_url: input.imageUrl
      }
    ]
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(extractObjectWithToolCall).mockResolvedValue({
    ok: false,
    error: "summary model rejected the reduced compaction input"
  });
});

describe("estimateContextTokens file handling", () => {
  it("does not estimate PDF tokens from base64 file bytes", () => {
    const pdfPayload = "JVBERi0xLjQK".repeat(20_000);
    const fileItem: ResponseInputItem = {
      role: "user",
      content: [
        {
          type: "input_file",
          file_data: `data:application/pdf;base64,${pdfPayload}`,
          filename: "large-pages-1-50.pdf"
        }
      ]
    };

    const estimated = estimateContextTokens("", [fileItem], "gpt-5");

    expect(estimated).toBe(24);
  });

  it("skips file token estimates even when lightweight metadata is present", () => {
    const fileItem: ResponseInputItem = {
      role: "user",
      content: [
        {
          type: "input_file",
          file_id: "file_123",
          file_url: "https://example.com/files/report.pdf",
          filename: "report.pdf"
        }
      ]
    };

    const estimated = estimateContextTokens("", [fileItem], "gpt-5");

    expect(estimated).toBe(24);
  });

  it("serializes inline PDF attachments without embedding the file bytes", () => {
    const pdfPayload = "JVBERi0xLjQK".repeat(20_000);

    const serialized = stringifyContextEstimateValue({
      type: "input_file",
      file_data: `data:application/pdf;base64,${pdfPayload}`,
      filename: "large-pages-1-50.pdf"
    });

    expect(serialized).toContain("[input_file]");
    expect(serialized).toContain("filename=large-pages-1-50.pdf");
    expect(serialized).not.toContain("JVBERi0xLjQKJVBERi0xLjQK");
    expect(serialized).not.toContain("base64");
  });
});

describe("estimateContextTokens image handling", () => {
  it("uses o4-mini patch pricing instead of data-url text length", () => {
    const imageItem = buildImageInputItem({
      imageUrl: createPngDataUrl(1024, 1024),
      detail: "high"
    });

    const estimated = estimateContextTokens("", [imageItem], "o4-mini");

    // system overhead 16 + item overhead 8 + image cost ceil(1024 patches * 1.72) = 1762
    expect(estimated).toBe(1786);
  });

  it("caps o4-mini image token estimates at the documented patch ceiling", () => {
    const imageItem = buildImageInputItem({
      imageUrl: createPngDataUrl(4096, 4096),
      detail: "high"
    });

    const estimated = estimateContextTokens("", [imageItem], "o4-mini");

    // system overhead 16 + item overhead 8 + image cost ceil(1536 patches * 1.72) = 2642
    expect(estimated).toBe(2666);
  });

  it("applies low and high detail pricing for gpt-4o images", () => {
    const imageUrl = createPngDataUrl(1024, 1024);
    const lowDetail = estimateContextTokens("", [buildImageInputItem({ imageUrl, detail: "low" })], "gpt-4o");
    const highDetail = estimateContextTokens("", [buildImageInputItem({ imageUrl, detail: "high" })], "gpt-4o");

    // low detail: 85 image tokens, high detail: 85 + 4 tiles * 170 = 765
    expect(lowDetail).toBe(109);
    expect(highDetail).toBe(789);
    expect(highDetail).toBeGreaterThan(lowDetail);
  });

  it("serializes inline images without embedding the data url", () => {
    const serialized = stringifyContextEstimateValue({
      type: "input_image",
      detail: "high",
      image_url: createPngDataUrl(1024, 1024)
    });

    expect(serialized).toContain("[input_image]");
    expect(serialized).toContain("detail=high");
    expect(serialized).toContain("size=1024x1024");
    expect(serialized).toContain("source=inline_data_url");
    expect(serialized).not.toContain("base64");
  });
});

describe("selectCompactionLiveTailItems", () => {
  it("expands the tail to preserve a function call with its output", () => {
    const items: ResponseInputItem[] = [
      { role: "user", content: "start" },
      { type: "function_call", call_id: "call_1", name: "demo_tool", arguments: "{}" } as ResponseInputItem,
      { type: "function_call_output", call_id: "call_1", output: "{\"ok\":true}" } as ResponseInputItem,
      { role: "assistant", content: "done" }
    ];

    const tail = selectCompactionLiveTailItems(items, 2);

    expect(tail).toEqual([
      { type: "function_call", call_id: "call_1", name: "demo_tool", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "{\"ok\":true}" },
      { role: "assistant", content: "done" }
    ]);
  });

  it("keeps function_call_output entries when the matching function_call is retained", () => {
    const items: ResponseInputItem[] = [
      { role: "user", content: "start" },
      { type: "function_call", call_id: "call_1", name: "demo_tool", arguments: "{}" } as ResponseInputItem,
      { type: "function_call_output", call_id: "call_1", output: "{\"ok\":true}" } as ResponseInputItem,
      { role: "assistant", content: "done" }
    ];

    const tail = selectCompactionLiveTailItems(items, 3);

    expect(tail).toEqual([
      { type: "function_call", call_id: "call_1", name: "demo_tool", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "{\"ok\":true}" },
      { role: "assistant", content: "done" }
    ]);
  });

  it("preserves custom-tool and apply-patch call/output pairs", () => {
    const items = [
      { type: "custom_tool_call", call_id: "custom_1", name: "shell", input: "pwd" },
      { type: "custom_tool_call_output", call_id: "custom_1", output: "/workspace" },
      { type: "apply_patch_call", call_id: "patch_1", patch: "*** Begin Patch" },
      { type: "apply_patch_call_output", call_id: "patch_1", status: "completed", output: "Done" },
      { role: "assistant", content: "done" }
    ] as unknown as ResponseInputItem[];

    expect(selectCompactionLiveTailItems(items, 2)).toEqual(items.slice(2));
    expect(selectCompactionLiveTailItems(items, 4)).toEqual(items);
  });

  it("keeps reasoning items attached to a retained tool call", () => {
    const items = [
      { role: "user", content: "start" },
      { type: "reasoning", summary: [{ type: "summary_text", text: "plan" }] },
      { type: "function_call", call_id: "call_1", name: "demo_tool", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "done" },
      { role: "assistant", content: "finished" }
    ] as ResponseInputItem[];

    expect(selectCompactionLiveTailItems(items, 2)).toEqual(items.slice(1));
  });
});

describe("prepareConversationHistoryChunksForCompaction", () => {
  it("summarizes every source item across bounded chunks instead of dropping the oldest items", () => {
    const items: ResponseInputItem[] = Array.from({ length: 12 }, (_, index) => ({
      role: "user",
      content: `unique-item-${index + 1} ${"x".repeat(3_000)}`
    }));

    const chunks = prepareConversationHistoryChunksForCompaction({
      conversationItems: items,
      compactionModel: "gpt-test",
      maxContextTokens: 2_000
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.omittedItemCount === 0)).toBe(true);
    const serialized = chunks.map((chunk) => chunk.conversationHistory).join("\n");
    for (let index = 1; index <= items.length; index += 1) {
      expect(serialized).toContain(`unique-item-${index} `);
    }
  });

  it("splits an oversized item into bounded fragments without losing its ending", () => {
    const content = `START-${"x".repeat(40_000)}-END`;
    const chunks = prepareConversationHistoryChunksForCompaction({
      conversationItems: [{ role: "user", content }],
      compactionModel: "gpt-test",
      maxContextTokens: 4_000
    });

    const serialized = chunks.map((chunk) => chunk.conversationHistory).join("\n");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.itemCharLimit <= 16_000)).toBe(true);
    expect(serialized).toContain("START-");
    expect(serialized).toContain("-END");
    expect(serialized).not.toContain("...[truncated");
  });
});

describe("normalizeCompactionLiveTailStartIndex", () => {
  it("clamps invalid model indexes to a two-to-thirty-two-item raw tail", () => {
    expect(normalizeCompactionLiveTailStartIndex({ requestedStartIndex: -100, sourceItemCount: 100 })).toBe(69);
    expect(normalizeCompactionLiveTailStartIndex({ requestedStartIndex: 500, sourceItemCount: 100 })).toBe(99);
    expect(normalizeCompactionLiveTailStartIndex({ requestedStartIndex: Number.NaN, sourceItemCount: 100 })).toBe(99);
    expect(normalizeCompactionLiveTailStartIndex({ requestedStartIndex: 1, sourceItemCount: 6 })).toBe(1);
  });
});

describe("compactContextNow", () => {
  it("compacts a single conversation item", async () => {
    vi.mocked(extractObjectWithToolCall).mockResolvedValueOnce({
      ok: true,
      value: {
        summary_markdown: "Single-item summary.",
        live_tail_start_index: 1
      }
    });
    const conversationItems: ResponseInputItem[] = [{ role: "user", content: "Only message" }];

    const result = await compactContextNow({
      provider: { apiKey: "test", baseUrl: "https://example.com/v1" },
      taskId: "task-single-item",
      step: 1,
      model: "gpt-test",
      maxContextTokens: 100_000,
      systemPrompt: "system",
      conversationItems,
      runPersistedItems: []
    });

    expect(result.status).toBe("compacted");
    expect(extractObjectWithToolCall).toHaveBeenCalledOnce();
  });

  it("persists the exact summary and live-tail items used after compaction", async () => {
    vi.mocked(extractObjectWithToolCall).mockResolvedValueOnce({
      ok: true,
      value: {
        summary_markdown: "Earlier context summary.",
        live_tail_start_index: 7
      }
    });
    const conversationItems: ResponseInputItem[] = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message ${index + 1}`
    }));
    const runPersistedItems: ResponseInputItem[] = [{ role: "assistant", content: "pending" }];

    const result = await compactContextNow({
      provider: { apiKey: "test", baseUrl: "https://example.com/v1" },
      taskId: "task-persist",
      step: 2,
      model: "gpt-test",
      maxContextTokens: 100_000,
      systemPrompt: "system",
      conversationItems,
      runPersistedItems
    });

    expect(result.status).toBe("compacted");
    expect(runPersistedItems).toEqual([]);
    const persistedPayload = vi.mocked(appendMessage).mock.calls[0][2] as Record<string, unknown>;
    expect(persistedPayload.response_items).toEqual(conversationItems);
    expect(conversationItems.at(-2)).toEqual({ role: "user", content: "message 7" });
    expect(conversationItems.at(-1)).toEqual({ role: "assistant", content: "message 8" });
  });

  it("persists every summary chunk when the source exceeds one compaction request", async () => {
    const sourceItems: ResponseInputItem[] = Array.from({ length: 12 }, (_, index) => ({
      role: "user",
      content: `source-${index + 1} ${"x".repeat(3_000)}`
    }));
    const expectedChunks = prepareConversationHistoryChunksForCompaction({
      conversationItems: sourceItems,
      compactionModel: "gpt-test",
      maxContextTokens: 2_000
    });
    let summaryIndex = 0;
    vi.mocked(extractObjectWithToolCall).mockImplementation(async () => {
      summaryIndex += 1;
      return {
        ok: true,
        value: {
          summary_markdown: `Summary ${summaryIndex}`,
          live_tail_start_index: 11
        }
      };
    });
    const conversationItems = [...sourceItems];

    const result = await compactContextNow({
      provider: { apiKey: "test", baseUrl: "https://example.com/v1" },
      taskId: "task-chunks",
      step: 4,
      model: "gpt-test",
      maxContextTokens: 2_000,
      systemPrompt: "system",
      conversationItems,
      runPersistedItems: []
    });

    expect(result.status).toBe("compacted");
    expect(extractObjectWithToolCall).toHaveBeenCalledTimes(expectedChunks.length);
    const persistedPayload = vi.mocked(appendMessage).mock.calls[0][2] as {
      response_items: ResponseInputItem[];
      compaction_state: { segments: Array<{ summary_markdown: string }> };
    };
    expect(persistedPayload.compaction_state.segments).toHaveLength(expectedChunks.length);
    expect(persistedPayload.compaction_state.segments.map((segment) => segment.summary_markdown)).toEqual(
      expectedChunks.map((_, index) => `Summary ${index + 1}`)
    );
    expect(persistedPayload.response_items).toEqual(conversationItems);
    expect(conversationItems.slice(-2)).toEqual(sourceItems.slice(-2));
  });
});

describe("maybeAutoCompactContext", () => {
  it("uses API input tokens as the auto-compaction baseline", async () => {
    vi.mocked(extractObjectWithToolCall).mockResolvedValueOnce({
      ok: true,
      value: {
        summary_markdown: "API usage summary.",
        live_tail_start_index: 1
      }
    });
    const conversationItems: ResponseInputItem[] = [{ role: "user", content: "Small local estimate" }];
    const estimatedInputTokens = estimateContextTokens("system", conversationItems, "gpt-test");

    const result = await maybeAutoCompactContext({
      provider: { apiKey: "test", baseUrl: "https://example.com/v1" },
      taskId: "task-actual-usage",
      step: 1,
      model: "gpt-test",
      maxContextTokens: 1_000,
      systemPrompt: "system",
      conversationItems,
      runPersistedItems: [],
      actualInputTokens: 850,
      estimatedInputTokensAtActualMeasurement: estimatedInputTokens
    });

    expect(result.status).toBe("compacted");
    expect(result.usageBefore).toMatchObject({
      usedTokens: 850,
      source: "actual"
    });
  });

  it("falls back to a bounded trim when native auto compaction has no observed effect", async () => {
    const conversationItems: ResponseInputItem[] = [
      { role: "user", content: "Earlier task context" },
      { role: "assistant", content: "Earlier work" }
    ];
    const estimatedInputTokens = estimateContextTokens("system", conversationItems, "gpt-test");
    vi.mocked(compactWithNativeBackend).mockResolvedValueOnce({
      backend: "native",
      model: "gpt-test",
      markerText: "Native context",
      responseItems: [{ type: "compaction", id: "cmp_1", encrypted_content: "opaque" }] as ResponseInputItem[],
      nextItems: [{ type: "compaction", id: "cmp_1", encrypted_content: "opaque" }] as ResponseInputItem[],
      usageAfter: {
        usedTokens: 10,
        maxContextTokens: 1_000,
        utilization: 0.01,
        source: "estimate",
        stage: "post_compaction",
        step: 1
      },
      messageMetadata: {},
      completionMetadata: {}
    });

    await expect(maybeAutoCompactContext({
      provider: { apiKey: "test", baseUrl: "https://api.openai.com/v1" },
      taskId: "task-native-loop-guard",
      step: 1,
      model: "gpt-test",
      compactionBackend: "native",
      maxContextTokens: 1_000,
      systemPrompt: "system",
      conversationItems,
      runPersistedItems: [],
      actualInputTokens: 850,
      estimatedInputTokensAtActualMeasurement: estimatedInputTokens
    })).resolves.toMatchObject({ status: "compacted", backend: "native" });

    const compactedEstimate = estimateContextTokens("system", conversationItems, "gpt-test");
    const result = await maybeAutoCompactContext({
      provider: { apiKey: "test", baseUrl: "https://api.openai.com/v1" },
      taskId: "task-native-loop-guard",
      step: 2,
      model: "gpt-test",
      compactionBackend: "native",
      maxContextTokens: 1_000,
      systemPrompt: "system",
      conversationItems,
      runPersistedItems: [],
      actualInputTokens: 900,
      estimatedInputTokensAtActualMeasurement: compactedEstimate
    });

    expect(result).toMatchObject({ status: "compacted", backend: "summary" });
    expect(conversationItems).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Native context compaction did not reduce")
      })
    ]);
    expect(compactWithNativeBackend).toHaveBeenCalledTimes(1);
  });
});

describe("recoverContextAfterContextWindowError", () => {
  it("falls back to a bounded trim marker when summary compaction fails", async () => {
    const conversationItems: ResponseInputItem[] = Array.from({ length: 20 }, (_, index) => ({
      role: "user",
      content: `message ${index + 1} ${"x".repeat(500)}`
    }));
    const runPersistedItems: ResponseInputItem[] = [
      { role: "assistant", content: "old persisted item" }
    ];

    const result = await recoverContextAfterContextWindowError({
      provider: {
        apiKey: "test",
        baseUrl: "https://example.com/v1"
      },
      taskId: "task-1",
      step: 3,
      model: "gpt-test",
      maxContextTokens: 1_200,
      systemPrompt: "system",
      conversationItems,
      runPersistedItems,
      getCurrentLeafMessageId: () => "leaf-1",
      reason: "Your input exceeds the context window of this model."
    });

    expect(result.status).toBe("compacted");
    expect(runPersistedItems).toEqual([]);
    expect(conversationItems[0]).toEqual(expect.objectContaining({
      role: "system",
      content: expect.stringContaining("## Context Trim Recovery")
    }));
    expect(conversationItems.length).toBeLessThanOrEqual(9);
    expect(appendMessage).toHaveBeenCalledWith(
      "task-1",
      "system",
      expect.objectContaining({
        kind: "context_compaction",
        response_items: [
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("## Context Trim Recovery")
          })
        ],
        compaction: expect.objectContaining({
          trigger: "recovery",
          recoveryFallback: "trim",
          sourceItemCount: 20
        })
      }),
      expect.objectContaining({
        parentMessageId: "leaf-1"
      })
    );
    expect(emitTaskEvent).toHaveBeenCalledWith("task-1", "compaction", expect.objectContaining({
      trigger: "recovery",
      status: "completed",
      recoveryFallback: "trim"
    }));
  });
});
