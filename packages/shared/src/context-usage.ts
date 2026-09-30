export interface ContextUsageSelectionCandidate {
  source?: string | null;
  createdAt?: string | null;
}

export function calculateContextUsagePercent(usedTokens: number, maxContextTokens: number): number {
  if (!Number.isFinite(usedTokens) || !Number.isFinite(maxContextTokens) || maxContextTokens <= 0) {
    return 0;
  }

  const ratio = Math.min(1, Math.max(0, usedTokens / maxContextTokens));
  return Math.round(ratio * 100);
}

function isActualContextUsageSource(source: string | null | undefined): boolean {
  return source === "actual";
}

function parseContextUsageCreatedAt(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function selectPreferredContextUsage<T extends ContextUsageSelectionCandidate>(
  current: T | null | undefined,
  candidate: T | null | undefined
): T | null {
  if (!current) {
    return candidate ?? null;
  }

  if (!candidate) {
    return current;
  }

  const currentIsActual = isActualContextUsageSource(current.source);
  const candidateIsActual = isActualContextUsageSource(candidate.source);

  if (currentIsActual !== candidateIsActual) {
    return candidateIsActual ? candidate : current;
  }

  const currentCreatedAt = parseContextUsageCreatedAt(current.createdAt);
  const candidateCreatedAt = parseContextUsageCreatedAt(candidate.createdAt);

  if (currentCreatedAt === null && candidateCreatedAt === null) {
    return candidate;
  }

  if (currentCreatedAt === null) {
    return candidate;
  }

  if (candidateCreatedAt === null) {
    return current;
  }

  return candidateCreatedAt >= currentCreatedAt ? candidate : current;
}
