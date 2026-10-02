import { toSafeInteger, type TokenUsageTotals } from "@meowbert/shared";

// SQL aggregation over `user_token_usage_events` rows. `input_tokens` is stored as the
// provider-reported prompt total (cache reads included), so uncached input is derived here.
// Weighted cached/output contributions are rebuilt from each row's stored multipliers;
// weighted input is the remainder of `weighted_tokens`, which also carries the
// cache-write premium. `output_weight` equals the output multiplier on every row,
// including rows recorded before per-category multipliers existed.
export const TOKEN_USAGE_AGGREGATE_COLUMNS = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "total_tokens",
  "weighted_tokens",
  "weighted_cached_input_tokens",
  "weighted_output_tokens",
  "request_count"
] as const;

export type TokenUsageAggregateRow = {
  [Column in (typeof TOKEN_USAGE_AGGREGATE_COLUMNS)[number]]: string | number | null;
};

export function tokenUsageAggregateSql(alias = "e"): string {
  return `COALESCE(SUM(GREATEST(${alias}.input_tokens - ${alias}.cached_input_tokens, 0)), 0)::text AS input_tokens,
          COALESCE(SUM(${alias}.cached_input_tokens), 0)::text AS cached_input_tokens,
          COALESCE(SUM(${alias}.output_tokens), 0)::text AS output_tokens,
          COALESCE(SUM(${alias}.reasoning_tokens), 0)::text AS reasoning_tokens,
          COALESCE(SUM(${alias}.input_tokens + ${alias}.output_tokens), 0)::text AS total_tokens,
          COALESCE(SUM(${alias}.weighted_tokens), 0)::text AS weighted_tokens,
          ROUND(COALESCE(SUM(
            ${alias}.cached_input_tokens * ${alias}.cached_input_token_multiplier * ${alias}.usage_rate_multiplier
          ), 0))::text AS weighted_cached_input_tokens,
          ROUND(COALESCE(SUM(
            (
              GREATEST(${alias}.output_tokens - ${alias}.reasoning_tokens, 0) * ${alias}.output_weight
              + ${alias}.reasoning_tokens * ${alias}.reasoning_token_multiplier
            ) * ${alias}.usage_rate_multiplier
          ), 0))::text AS weighted_output_tokens,
          COUNT(*)::text AS request_count`;
}

export function mapTokenUsageTotals(row: Partial<TokenUsageAggregateRow> | undefined): TokenUsageTotals {
  const weightedTokens = toSafeInteger(row?.weighted_tokens);
  const weightedCachedInputTokens = Math.min(weightedTokens, toSafeInteger(row?.weighted_cached_input_tokens));
  const weightedOutputTokens = Math.min(
    weightedTokens - weightedCachedInputTokens,
    toSafeInteger(row?.weighted_output_tokens)
  );

  return {
    inputTokens: toSafeInteger(row?.input_tokens),
    cachedInputTokens: toSafeInteger(row?.cached_input_tokens),
    outputTokens: toSafeInteger(row?.output_tokens),
    reasoningTokens: toSafeInteger(row?.reasoning_tokens),
    totalTokens: toSafeInteger(row?.total_tokens),
    weightedTokens,
    weightedInputTokens: weightedTokens - weightedCachedInputTokens - weightedOutputTokens,
    weightedCachedInputTokens,
    weightedOutputTokens,
    requestCount: toSafeInteger(row?.request_count)
  };
}
