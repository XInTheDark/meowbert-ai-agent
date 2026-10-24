import type { PlatformModelMetadata } from "@meowbert/shared";

// Adapted from openai/codex at 970111f6 (Apache-2.0): ModelInfo::auto_compact_token_limit
// and core/src/session/context_window.rs, using its default total-context scope.
export const CONTEXT_REMINDER_THRESHOLD_TOKENS = 6_144;
export const CONTEXT_FALLBACK_BUFFER_TOKENS = 16_384;

export interface ContextWindowBudget {
  baseLimit: number;
  hardLimit: number;
  rolloverLimit: number;
}

export interface ContextWindowTokenStatus {
  activeTokens: number;
  tokensRemaining: number;
  limitReached: boolean;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export function resolveContextWindowBudget(input: {
  contextWindow: number;
  model: string;
  metadata: PlatformModelMetadata;
}): ContextWindowBudget {
  const entry = input.metadata[input.model];
  const defaults = input.metadata.default;
  const configuredLimit = positiveInteger(entry?.auto_compact_token_limit)
    ?? positiveInteger(defaults?.auto_compact_token_limit);
  const configuredPercent = positiveInteger(entry?.effective_context_window_percent)
    ?? positiveInteger(defaults?.effective_context_window_percent);
  const effectivePercent = configuredPercent !== null && configuredPercent <= 100 ? configuredPercent : 95;
  const baseLimit = Math.min(Math.floor(input.contextWindow * 9 / 10), configuredLimit ?? Infinity);
  const hardLimit = Math.floor(input.contextWindow * effectivePercent / 100);
  return {
    baseLimit,
    hardLimit,
    rolloverLimit: Math.min(baseLimit + CONTEXT_FALLBACK_BUFFER_TOKENS, hardLimit)
  };
}

export function calculateContextWindowTokenStatus(budget: ContextWindowBudget, activeTokens: number): ContextWindowTokenStatus {
  return {
    activeTokens,
    tokensRemaining: Math.max(0, Math.min(budget.baseLimit - activeTokens, budget.hardLimit - activeTokens)),
    limitReached: activeTokens >= budget.rolloverLimit
  };
}
