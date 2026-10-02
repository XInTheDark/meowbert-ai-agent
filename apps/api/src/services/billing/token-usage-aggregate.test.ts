import { describe, expect, it } from "vitest";
import { mapTokenUsageTotals } from "./token-usage-aggregate.js";

describe("mapTokenUsageTotals", () => {
  it("splits weighted usage so the categories add up to the billed total", () => {
    const totals = mapTokenUsageTotals({
      input_tokens: "700",
      cached_input_tokens: "800",
      output_tokens: "150",
      reasoning_tokens: "40",
      total_tokens: "1650",
      weighted_tokens: "1793",
      weighted_cached_input_tokens: "80",
      weighted_output_tokens: "600",
      request_count: "2"
    });

    expect(totals).toMatchObject({
      inputTokens: 700,
      cachedInputTokens: 800,
      weightedInputTokens: 1113,
      weightedCachedInputTokens: 80,
      weightedOutputTokens: 600
    });
    expect(totals.weightedInputTokens + totals.weightedCachedInputTokens + totals.weightedOutputTokens)
      .toBe(totals.weightedTokens);
  });

  it("never reports negative weighted input when rounding overshoots the total", () => {
    const totals = mapTokenUsageTotals({
      weighted_tokens: "10",
      weighted_cached_input_tokens: "6",
      weighted_output_tokens: "5"
    });

    expect(totals.weightedInputTokens).toBe(0);
    expect(totals.weightedCachedInputTokens + totals.weightedOutputTokens).toBe(10);
  });
});
