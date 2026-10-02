import { computeCacheHitRate, type TokenUsageTotals } from "@meowbert/shared/token-usage-stats";
import { formatCompactNumber, formatNumber, formatRatioPercent } from "../../../../components/usage/tokenUsageFormat";

export type MetricKey = "totalTokens" | "weightedTokens" | "requestCount" | "cacheHitRate";

export const METRIC_OPTIONS: Array<{ key: MetricKey; label: string }> = [
  { key: "totalTokens", label: "Tokens" },
  { key: "weightedTokens", label: "Weighted tokens" },
  { key: "requestCount", label: "Requests" },
  { key: "cacheHitRate", label: "Cache hit rate" }
];

export function labelForMetric(metric: MetricKey): string {
  return METRIC_OPTIONS.find((option) => option.key === metric)?.label ?? "Tokens";
}

// Cache hit rate is null where nothing was sent to the model, so charts can leave a gap.
export function valueForMetric(row: TokenUsageTotals, metric: MetricKey): number | null {
  return metric === "cacheHitRate" ? computeCacheHitRate(row) : row[metric];
}

export function metricScaleMax(rows: TokenUsageTotals[], metric: MetricKey): number {
  if (metric === "cacheHitRate") {
    return 1;
  }
  return Math.max(...rows.map((row) => valueForMetric(row, metric) ?? 0), 1);
}

export function formatMetricValue(value: number | null, metric: MetricKey, compact = true): string {
  if (metric === "cacheHitRate") {
    return formatRatioPercent(value);
  }
  return compact ? formatCompactNumber(value ?? 0) : formatNumber(value ?? 0);
}
