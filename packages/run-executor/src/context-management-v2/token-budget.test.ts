import { describe, expect, it } from "vitest";
import { calculateContextWindowTokenStatus, resolveContextWindowBudget } from "./token-budget.js";

describe("V2 context-window budget", () => {
  it("keeps a checkpoint reserve beyond the base limit, capped by the usable model window", () => {
    const budget = resolveContextWindowBudget({ contextWindow: 256_000, model: "test", metadata: {} });
    expect(budget).toEqual({ baseLimit: 230_400, hardLimit: 243_200, rolloverLimit: 243_200 });
    expect(calculateContextWindowTokenStatus(budget, 230_399)).toMatchObject({ tokensRemaining: 1, limitReached: false });
    expect(calculateContextWindowTokenStatus(budget, 230_400)).toMatchObject({ tokensRemaining: 0, limitReached: false });
    expect(calculateContextWindowTokenStatus(budget, 243_199).limitReached).toBe(false);
    expect(calculateContextWindowTokenStatus(budget, 243_200)).toMatchObject({ tokensRemaining: 0, limitReached: true });
  });

  it("uses the complete fallback buffer when the model has enough headroom", () => {
    const budget = resolveContextWindowBudget({ contextWindow: 1_000_000, model: "test", metadata: {} });
    expect(budget).toEqual({ baseLimit: 900_000, hardLimit: 950_000, rolloverLimit: 916_384 });
    expect(calculateContextWindowTokenStatus(budget, 916_383).limitReached).toBe(false);
    expect(calculateContextWindowTokenStatus(budget, 916_384).limitReached).toBe(true);
  });

  it("honors a smaller configured base limit and exact model headroom", () => {
    const budget = resolveContextWindowBudget({
      contextWindow: 100_000,
      model: "test",
      metadata: {
        default: { auto_compact_token_limit: 60_000, effective_context_window_percent: 95 },
        test: { auto_compact_token_limit: 70_000, effective_context_window_percent: 80 }
      }
    });
    expect(budget).toEqual({ baseLimit: 70_000, hardLimit: 80_000, rolloverLimit: 80_000 });
    expect(calculateContextWindowTokenStatus(budget, 70_001).tokensRemaining).toBe(0);
  });

  it("caps an oversized configured base limit at 90 percent and rejects invalid metadata", () => {
    expect(resolveContextWindowBudget({
      contextWindow: 100_000,
      model: "test",
      metadata: { test: { auto_compact_token_limit: 200_000, effective_context_window_percent: 200 } }
    })).toEqual({ baseLimit: 90_000, hardLimit: 95_000, rolloverLimit: 95_000 });
    expect(resolveContextWindowBudget({
      contextWindow: 100_000,
      model: "test",
      metadata: { default: { auto_compact_token_limit: -1, effective_context_window_percent: NaN } }
    })).toEqual({ baseLimit: 90_000, hardLimit: 95_000, rolloverLimit: 95_000 });
  });

  it("reports the hard model limit when it is smaller than the base budget", () => {
    const budget = resolveContextWindowBudget({
      contextWindow: 100_000, model: "test", metadata: { test: { effective_context_window_percent: 80 } }
    });
    expect(calculateContextWindowTokenStatus(budget, 79_999)).toMatchObject({ tokensRemaining: 1, limitReached: false });
    expect(calculateContextWindowTokenStatus(budget, 80_000).limitReached).toBe(true);
  });
});
