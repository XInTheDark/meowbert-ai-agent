import { z } from "zod";

export const REVIEW_EFFORT_LEVELS = ["standard", "thorough"] as const;
export type ReviewEffort = typeof REVIEW_EFFORT_LEVELS[number];
export const reviewEffortSchema = z.enum(REVIEW_EFFORT_LEVELS);

export function normalizeReviewEffort(value: unknown): ReviewEffort {
  return value === "thorough" ? "thorough" : "standard";
}

export const REVIEW_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type ReviewPriority = typeof REVIEW_PRIORITIES[number];

const findingDetails = {
  location: z.string().trim().min(1),
  issue: z.string().trim().min(1)
};

// Old fork snapshots still offer severity-based submit tools. Keep their payloads intact.
export const reviewFindingSchema = z.union([
  z.strictObject({ priority: z.enum(REVIEW_PRIORITIES), ...findingDetails }),
  z.strictObject({ severity: z.enum(["must_fix", "should_fix"]), ...findingDetails })
]);

export type ReviewFinding = {
  location: string;
  issue: string;
} & ({ priority: ReviewPriority; severity?: never } | { priority?: never; severity: string });
