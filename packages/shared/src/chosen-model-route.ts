// A model router decision made before the run: the Project Master picks one of the router's
// target models itself, and the runtime uses that pick instead of asking the router.
export interface ChosenModelRoute {
  routerId: string;
  modelId: string;
  reasoningScore: number;
}

export const CHOSEN_MODEL_ROUTE_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type ChosenModelRouteEffort = typeof CHOSEN_MODEL_ROUTE_EFFORTS[number];

// Midpoints of the router's reasoning score bands, so each effort maps back to itself.
const EFFORT_REASONING_SCORES: Record<ChosenModelRouteEffort, number> = { low: 12, medium: 37, high: 62, xhigh: 87 };
// Matches the router's own fallback score when no effort is given.
const DEFAULT_REASONING_SCORE = 50;

export function reasoningScoreForEffort(effort: ChosenModelRouteEffort | null): number {
  return effort ? EFFORT_REASONING_SCORES[effort] : DEFAULT_REASONING_SCORE;
}

export function parseChosenModelRoute(value: unknown): ChosenModelRoute | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.routerId !== "string" || !record.routerId.trim()) return null;
  if (typeof record.modelId !== "string" || !record.modelId.trim()) return null;
  if (typeof record.reasoningScore !== "number" || !Number.isFinite(record.reasoningScore)) return null;
  return {
    routerId: record.routerId.trim(),
    modelId: record.modelId.trim(),
    reasoningScore: Math.max(0, Math.min(100, Math.round(record.reasoningScore)))
  };
}
