// Token counts from a Responses API `usage` object. `inputTokens` is the provider-reported
// prompt total, which already includes cache reads (`cachedInputTokens`) and cache writes.
export interface ModelUsageCounts {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

function readTokenCount(source: unknown, key: string): number {
  if (typeof source !== "object" || source === null) {
    return 0;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function parseModelResponseUsage(usage: unknown): ModelUsageCounts | null {
  if (typeof usage !== "object" || usage === null || typeof (usage as { input_tokens?: unknown }).input_tokens !== "number") {
    return null;
  }

  const record = usage as Record<string, unknown>;
  return {
    inputTokens: readTokenCount(record, "input_tokens"),
    cachedInputTokens: readTokenCount(record.input_tokens_details, "cached_tokens"),
    cacheWriteInputTokens: readTokenCount(record.input_tokens_details, "cache_write_tokens"),
    outputTokens: readTokenCount(record, "output_tokens"),
    reasoningTokens: readTokenCount(record.output_tokens_details, "reasoning_tokens")
  };
}
