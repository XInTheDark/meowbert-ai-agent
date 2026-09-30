import { describe, expect, it } from "vitest";
import {
  computeUsageCostBreakdown,
  resolveUsageCostMultipliersForModel
} from "./usage-cost.js";

describe("resolveUsageCostMultipliersForModel", () => {
  it("reads usage multipliers from model metadata with default fallback", () => {
    expect(
      resolveUsageCostMultipliersForModel("gpt-5.4", {
        default: {
          context_window: 256_000,
          usage_multipliers: {
            input_tokens: 1,
            cached_input_tokens: 0.25,
            output_tokens: 4,
            reasoning_tokens: 4
          }
        },
        "gpt-5.4": {
          context_window: 800_000,
          usage_multipliers: {
            output_tokens: 5
          }
        }
      })
    ).toEqual({
      inputTokens: 1,
      cachedInputTokens: 0.25,
      cacheWriteInputTokens: 1.25,
      outputTokens: 5,
      reasoningTokens: 4
    });
  });

  it("defaults missing multipliers to 1", () => {
    expect(resolveUsageCostMultipliersForModel("unknown", { default: { context_window: 256_000 } })).toEqual({
      inputTokens: 1,
      cachedInputTokens: 1,
      cacheWriteInputTokens: 1.25,
      outputTokens: 1,
      reasoningTokens: 1
    });
  });
});

describe("computeUsageCostBreakdown", () => {
  it("prices cached reads and cache writes separately from uncached input", () => {
    expect(
      computeUsageCostBreakdown({
        inputTokens: 100,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 30,
        outputTokens: 30,
        reasoningTokens: 10,
        multipliers: {
          inputTokens: 1,
          cachedInputTokens: 0.25,
          cacheWriteInputTokens: 1.25,
          outputTokens: 4,
          reasoningTokens: 5
        },
        rateMultiplier: 2
      })
    ).toMatchObject({
      billableInputTokens: 60,
      cachedInputTokens: 40,
      cacheWriteInputTokens: 30,
      visibleOutputTokens: 20,
      reasoningTokens: 10,
      weightedTokens: 415
    });
  });
});
