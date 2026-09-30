export const MEMORY_SYNTHESIS_MIN_REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1_000;
export const MEMORY_SYNTHESIS_URGENCY_THRESHOLD = 0.8;

export function calculateSessionWeight(tokens: number): number {
  return Math.min(Math.log1p(Math.max(0, tokens) / 40_000) / Math.log1p(10), 2.5);
}

export function calculateUserSessionsWeightedCount(sessions: Array<{ tokens: number } | number>): number {
  return sessions.reduce<number>((total, s) => {
    const tokens = typeof s === "number" ? s : s.tokens;
    return total + calculateSessionWeight(tokens);
  }, 0);
}

export function calculateMemorySynthesisUrgency(input: {
  now: Date;
  lastRefreshAt: string | null;
  earliestDeltaAt: string | null;
  userSessionsWeightedCount: number;
  deltaCharCount: number;
}): number {
  const referenceTime = input.lastRefreshAt ?? input.earliestDeltaAt;
  const elapsedDays = referenceTime
    ? Math.max(0, input.now.getTime() - new Date(referenceTime).getTime()) / 86_400_000
    : 0;
  const ageScore = Math.min(elapsedDays / 3, 1);
  const sessionScore = Math.min(Math.max(0, input.userSessionsWeightedCount) / 3.5, 1);
  const deltaScore = Math.min(Math.log1p(Math.max(0, input.deltaCharCount) / 1_000) / Math.log1p(80), 1);

  return 2 * (0.35 * ageScore + 0.40 * sessionScore + 0.25 * deltaScore);
}

