// A beat is sent this long before the cache would expire, leaving room for retries while the
// provider is busy (Meridian runs one beat at a time and never takes its last free slot).
export const CACHEBEAT_LEAD_MS = 10 * 60_000;
// Idle compaction runs after the window ends; the cache must still be warm for it.
export const CACHEBEAT_COMPACTION_ROOM_MS = 10 * 60_000;
// Never beat this close to expiry: a beat that lands after it would rewrite the whole cache.
const EXPIRY_SAFETY_MS = 2 * 60_000;
export const CACHEBEAT_RETRY_MS = 60_000;

export type CachebeatPlan = { kind: "beat" } | { kind: "wait"; delayMs: number } | { kind: "done" };

export interface CachebeatPlanInput {
  nowMs: number;
  // The latest read of the cache: the last request, or the last beat that reached the provider.
  cacheReadAtMs: number;
  ttlMs: number;
  windowEndMs: number;
}

// Beats only when the cache would otherwise expire before the window ends and compaction has run,
// and as late as is safe, so each beat buys a full cache lifetime.
export function planCachebeat(input: CachebeatPlanInput): CachebeatPlan {
  const expiresAtMs = input.cacheReadAtMs + input.ttlMs;
  if (input.nowMs >= expiresAtMs - EXPIRY_SAFETY_MS) return { kind: "done" };
  const needsBeat = input.windowEndMs + CACHEBEAT_COMPACTION_ROOM_MS > expiresAtMs;
  if (!needsBeat) {
    return input.nowMs >= input.windowEndMs ? { kind: "done" } : { kind: "wait", delayMs: input.windowEndMs - input.nowMs };
  }
  const beatAtMs = expiresAtMs - CACHEBEAT_LEAD_MS;
  return input.nowMs >= beatAtMs ? { kind: "beat" } : { kind: "wait", delayMs: beatAtMs - input.nowMs };
}

// After a beat that could not run, try again while it can still land before expiry.
export function planCachebeatRetry(input: { nowMs: number; cacheReadAtMs: number; ttlMs: number }): CachebeatPlan {
  const lastSafeMs = input.cacheReadAtMs + input.ttlMs - EXPIRY_SAFETY_MS;
  return input.nowMs + CACHEBEAT_RETRY_MS < lastSafeMs ? { kind: "wait", delayMs: CACHEBEAT_RETRY_MS } : { kind: "done" };
}
