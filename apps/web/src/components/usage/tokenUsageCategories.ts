import type { TokenUsageTotals } from "@meowbert/shared/token-usage-stats";

export type TokenUsageWeighting = "raw" | "weighted";

export interface TokenUsageCategory {
  key: "input" | "cached" | "output";
  label: string;
  value: number;
}

export function tokenUsageCategories(totals: TokenUsageTotals, weighting: TokenUsageWeighting): TokenUsageCategory[] {
  const weighted = weighting === "weighted";
  return [
    { key: "input", label: "Input", value: weighted ? totals.weightedInputTokens : totals.inputTokens },
    { key: "cached", label: "Cached", value: weighted ? totals.weightedCachedInputTokens : totals.cachedInputTokens },
    { key: "output", label: "Output", value: weighted ? totals.weightedOutputTokens : totals.outputTokens }
  ];
}
