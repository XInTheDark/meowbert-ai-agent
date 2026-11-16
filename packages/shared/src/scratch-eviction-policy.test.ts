import { describe, expect, it } from "vitest";
import { rankScratchCandidates, scratchNeedsCleanup, type ScratchCandidate } from "./scratch-eviction-policy.js";

const now = 20 * 86_400_000;
function task(id: string, size: number | null, days: number, workspaceId = "workspace"): ScratchCandidate {
  return { id, workspaceId, sizeBytes: size, idleSince: now - days * 86_400_000 };
}

describe("scratch eviction policy", () => {
  it("reclaims a large day-old working copy before a smaller week-old one, retaining recent scratch", () => {
    const tasks = [task("small", 200, 7), task("large", 2400, 1), task("recent", 9000, 0.01)];
    expect(rankScratchCandidates(tasks, new Map(), 10000, now, 3_600_000).map((t) => t.id)).toEqual(["large", "small"]);
  });

  it("prefers an over-budget workspace when age and size are otherwise equal", () => {
    const tasks = [task("light", 100, 1, "light"), task("heavy", 100, 1, "heavy")];
    expect(rankScratchCandidates(tasks, new Map([["light", 100], ["heavy", 800]]), 1000, now, 0)[0].id).toBe("heavy");
  });

  it("falls back to age for unknown sizes without making them outrank known large scratch", () => {
    const tasks = [task("new", null, 1), task("old", null, 7), task("known", 1000, 1)];
    expect(rankScratchCandidates(tasks, new Map(), 10000, now, 0).map((t) => t.id)).toEqual(["known", "old", "new"]);
  });

  it("uses the Admin budget and independently responds to physical free space", () => {
    expect(scratchNeedsCleanup(18, 82, 100, 20, 0.85)).toBe(true);
    expect(scratchNeedsCleanup(10, 10, 100, 100, 0.85)).toBe(true);
    expect(scratchNeedsCleanup(10, 90, 100, 20, 0.85)).toBe(false);
    expect(scratchNeedsCleanup(16, 84, 100, 20, 0.7)).toBe(true);
    expect(scratchNeedsCleanup(13, 87, 100, 20, 0.7)).toBe(false);
  });
});
