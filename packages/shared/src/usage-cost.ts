import { normalizePlatformModelMetadata, type PlatformModelMetadataEntry } from "./model-metadata.js";

export interface UsageCostMultipliers {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface UsageCostBreakdown {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  billableInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  visibleOutputTokens: number;
  multipliers: UsageCostMultipliers;
  rateMultiplier: number;
  weightedTokens: number;
}

export const DEFAULT_USAGE_COST_MULTIPLIERS: UsageCostMultipliers = {
  inputTokens: 1,
  cachedInputTokens: 1,
  cacheWriteInputTokens: 1.25,
  outputTokens: 1,
  reasoningTokens: 1
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return numeric;
}

export function normalizeUsageRateMultiplier(value: unknown): number {
  return normalizeNonNegativeNumber(value, 1);
}

function normalizeTokenCount(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function readMultiplier(entry: PlatformModelMetadataEntry | undefined, key: string): number | null {
  if (!entry) {
    return null;
  }

  const source = isPlainObject(entry.usage_multipliers) ? entry.usage_multipliers : entry;
  if (!(key in source)) {
    return null;
  }

  return normalizeNonNegativeNumber(source[key], DEFAULT_USAGE_COST_MULTIPLIERS.inputTokens);
}

function resolveMultiplier(
  modelEntry: PlatformModelMetadataEntry | undefined,
  defaultEntry: PlatformModelMetadataEntry | undefined,
  key: string
): number {
  return readMultiplier(modelEntry, key)
    ?? readMultiplier(defaultEntry, key)
    ?? DEFAULT_USAGE_COST_MULTIPLIERS.inputTokens;
}

export function resolveUsageCostMultipliersForModel(model: string, rawMetadata: unknown): UsageCostMultipliers {
  const metadata = normalizePlatformModelMetadata(rawMetadata);
  const modelKey = model.trim();
  const modelEntry = modelKey.length > 0 ? metadata[modelKey] : undefined;
  const defaultEntry = metadata.default;
  const inputTokens = resolveMultiplier(modelEntry, defaultEntry, "input_tokens");

  return {
    inputTokens,
    cachedInputTokens: resolveMultiplier(modelEntry, defaultEntry, "cached_input_tokens"),
    cacheWriteInputTokens: readMultiplier(modelEntry, "cache_write_input_tokens")
      ?? readMultiplier(defaultEntry, "cache_write_input_tokens")
      ?? inputTokens * 1.25,
    outputTokens: resolveMultiplier(modelEntry, defaultEntry, "output_tokens"),
    reasoningTokens: resolveMultiplier(modelEntry, defaultEntry, "reasoning_tokens")
  };
}

export function computeUsageCostBreakdown(input: {
  inputTokens: number;
  cachedInputTokens?: number | null;
  cacheWriteInputTokens?: number | null;
  outputTokens: number;
  reasoningTokens?: number | null;
  multipliers: UsageCostMultipliers;
  rateMultiplier: number;
}): UsageCostBreakdown {
  const inputTokens = normalizeTokenCount(input.inputTokens);
  const cachedInputTokens = Math.min(inputTokens, normalizeTokenCount(input.cachedInputTokens ?? 0));
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const cacheWriteInputTokens = Math.min(
    billableInputTokens,
    normalizeTokenCount(input.cacheWriteInputTokens ?? 0)
  );
  const uncachedInputTokens = billableInputTokens - cacheWriteInputTokens;
  const outputTokens = normalizeTokenCount(input.outputTokens);
  const reasoningTokens = Math.min(outputTokens, normalizeTokenCount(input.reasoningTokens ?? 0));
  const visibleOutputTokens = Math.max(0, outputTokens - reasoningTokens);
  const rateMultiplier = normalizeUsageRateMultiplier(input.rateMultiplier);

  const rawTotal =
    uncachedInputTokens * Math.max(0, input.multipliers.inputTokens)
    + cacheWriteInputTokens * Math.max(0, input.multipliers.cacheWriteInputTokens)
    + cachedInputTokens * Math.max(0, input.multipliers.cachedInputTokens)
    + visibleOutputTokens * Math.max(0, input.multipliers.outputTokens)
    + reasoningTokens * Math.max(0, input.multipliers.reasoningTokens);

  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    billableInputTokens,
    outputTokens,
    reasoningTokens,
    visibleOutputTokens,
    multipliers: {
      inputTokens: Math.max(0, input.multipliers.inputTokens),
      cachedInputTokens: Math.max(0, input.multipliers.cachedInputTokens),
      cacheWriteInputTokens: Math.max(0, input.multipliers.cacheWriteInputTokens),
      outputTokens: Math.max(0, input.multipliers.outputTokens),
      reasoningTokens: Math.max(0, input.multipliers.reasoningTokens)
    },
    rateMultiplier,
    weightedTokens: Math.max(0, Math.ceil(rawTotal * rateMultiplier))
  };
}
