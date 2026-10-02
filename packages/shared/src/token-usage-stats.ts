// Aggregated model token usage as shown in admin statistics and per-task usage.
// `inputTokens` counts only prompt tokens billed at the full input rate; cache reads are
// reported separately in `cachedInputTokens`. The weighted fields split `weightedTokens`
// into each category's contribution (cache-write premiums are part of weighted input).
export interface TokenUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  weightedTokens: number;
  weightedInputTokens: number;
  weightedCachedInputTokens: number;
  weightedOutputTokens: number;
  requestCount: number;
}

export interface TaskUsageRun extends TokenUsageTotals {
  runId: string | null;
  runKind: string | null;
  startedAt: string;
  models: string[];
}

export interface TaskUsageSummary {
  totals: TokenUsageTotals;
  runs: TaskUsageRun[];
  runCount: number;
}

export interface TaskUsageResponse {
  usage: TaskUsageSummary;
}

export function computeCacheHitRate(totals: Pick<TokenUsageTotals, "inputTokens" | "cachedInputTokens">): number | null {
  const promptTokens = totals.inputTokens + totals.cachedInputTokens;
  return promptTokens > 0 ? totals.cachedInputTokens / promptTokens : null;
}
