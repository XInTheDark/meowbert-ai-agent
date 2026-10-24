import { describe, expect, it } from "vitest";
import type { ResponseInputItem, ResponseUsage } from "openai/resources/responses/responses";
import { resolveContextWindowBudget } from "./token-budget.js";
import { estimateContextItemTokens } from "./token-estimation.js";
import { getContextWindowTokenStatus, getResponseTotalTokens, type ContextWindowUsage } from "./token-usage.js";

const budget = resolveContextWindowBudget({ contextWindow: 256_000, model: "test", metadata: {} });

describe("V2 active context usage", () => {
  it("includes the response's output tokens, using API totals when available", () => {
    expect(getResponseTotalTokens({ input_tokens: 100, output_tokens: 25, total_tokens: 125 } as ResponseUsage)).toBe(125);
    expect(getResponseTotalTokens({ input_tokens: 100, output_tokens: 25 } as ResponseUsage)).toBe(125);
    expect(getResponseTotalTokens({ input_tokens: 100, output_tokens: 25, total_tokens: 130 } as ResponseUsage)).toBe(130);
    expect(getResponseTotalTokens(undefined)).toBeNull();
  });

  it("adds new tool results and user messages without counting sampled history twice", () => {
    const usage: ContextWindowUsage = { budget, prefixItems: [], lastResponseTotalTokens: 200_000 };
    const items: ResponseInputItem[] = [
      { role: "user", content: "old".repeat(50_000) },
      { type: "function_call", name: "run_shell", call_id: "call", arguments: "{}" },
      { type: "function_call_output", call_id: "call", output: "x".repeat(4_000) },
      { role: "user", content: "😀".repeat(1_000) }
    ];
    expect(getContextWindowTokenStatus(usage, items)).toMatchObject({
      activeTokens: 202_001, tokensRemaining: 28_399, limitReached: false
    });
    usage.lastResponseTotalTokens = 210_000;
    items.push({ role: "assistant", content: "Sampled again." });
    expect(getContextWindowTokenStatus(usage, items).activeTokens).toBe(210_000);
  });

  it("counts all trailing results after a parallel batch of model tool calls", () => {
    const usage: ContextWindowUsage = { budget, prefixItems: [], lastResponseTotalTokens: 200_000 };
    const items: ResponseInputItem[] = [
      { type: "function_call", name: "run_shell", call_id: "one", arguments: "{}" },
      { type: "function_call", name: "run_shell", call_id: "two", arguments: "{}" },
      { type: "function_call_output", call_id: "one", output: "x".repeat(4_000) },
      { type: "function_call_output", call_id: "two", output: "x".repeat(4_000) }
    ];
    expect(getContextWindowTokenStatus(usage, items).activeTokens).toBe(202_002);
  });

  it("estimates restored or fresh context until a provider sample is available", () => {
    const usage: ContextWindowUsage = {
      budget, prefixItems: [{ role: "developer", content: "x".repeat(4_000) }], lastResponseTotalTokens: null
    };
    expect(getContextWindowTokenStatus(usage, [{ role: "user", content: "x".repeat(8_000) }])).toMatchObject({
      activeTokens: 3_000, tokensRemaining: 227_400
    });
  });
});

describe("Codex model-visible estimates", () => {
  it("counts UTF-8 content without transport escaping, roles, or message IDs", () => {
    expect(estimateContextItemTokens({ role: "user", content: "😀😀" })).toBe(2);
    expect(estimateContextItemTokens({ type: "message", role: "assistant", id: "a".repeat(10_000), content: [{ type: "output_text", text: "\n\"\\", annotations: [] }] } as ResponseInputItem)).toBe(1);
  });

  it("counts image content without counting the base64 transport payload as text", () => {
    expect(estimateContextItemTokens({
      type: "function_call_output", call_id: "call", output: [{ type: "input_image", image_url: `data:image/png;base64,${"A".repeat(1_000_000)}` }]
    } as ResponseInputItem)).toBe(1_845);
  });

  it("counts encrypted compaction and generated image items using Codex's estimates", () => {
    expect(estimateContextItemTokens({
      type: "context_compaction", encrypted_content: "x".repeat(120)
    } as ResponseInputItem)).toBe(10);
    expect(estimateContextItemTokens({
      type: "image_generation_call", result: "encoded-image", revised_prompt: "draw a house"
    } as ResponseInputItem)).toBe(1_847);
  });
});
