import { describe, expect, it } from "vitest";
import { normalizeReviewEffort, reviewEffortSchema, reviewFindingSchema, REVIEW_PRIORITIES } from "./review.js";

describe("review contracts", () => {
  it("defaults absent and historical effort metadata to standard", () => {
    for (const value of [undefined, null, "standard", "unknown"]) expect(normalizeReviewEffort(value)).toBe("standard");
    expect(normalizeReviewEffort("thorough")).toBe("thorough");
    expect(reviewEffortSchema.safeParse("high").success).toBe(false);
  });

  it.each(REVIEW_PRIORITIES)("accepts %s findings without changing their priority", (priority) => {
    const finding = { priority, location: "Slide 4", issue: "Labels overlap." };
    expect(reviewFindingSchema.parse(finding)).toEqual(finding);
  });

  it.each(["must_fix", "should_fix"])("preserves historical %s findings without assigning a priority", (severity) => {
    const finding = { severity, location: "Summary", issue: "Wrong total." };
    expect(reviewFindingSchema.parse(finding)).toEqual(finding);
  });

  it("rejects invalid, ambiguous and incomplete findings", () => {
    const details = { location: "Summary", issue: "Wrong total." };
    for (const finding of [
      { ...details, priority: "P4" }, { ...details, priority: 1 }, details,
      { ...details, priority: "P1", severity: "must_fix" },
      { ...details, priority: "P4", severity: "must_fix" },
      { ...details, severity: "critical" }, { priority: "P1", location: "", issue: "Wrong total." }
    ]) expect(reviewFindingSchema.safeParse(finding).success).toBe(false);
  });
});
