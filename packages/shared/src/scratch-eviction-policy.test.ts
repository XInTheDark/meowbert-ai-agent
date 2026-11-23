import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCRATCH_EVICTION_POLICY, rankScratchCandidates, scratchCleanupThresholds, scratchIdleExpiryMs, scratchNeedsCleanup,
  type ScratchCandidate
} from "./scratch-eviction-policy.js";

const DAY = 86_400_000;
const GB = 1024 ** 3;
const now = 20 * DAY;
function task(id: string, size: number | null, days: number, extra: Partial<ScratchCandidate> = {}): ScratchCandidate {
  return { id, workspaceId: "workspace", sizeBytes: size, idleSince: now - days * DAY, priority: "normal", completion: "open", ...extra };
}
function space(used: number, available: number, capacity: number, limit = capacity) {
  return { usedBytes: used, availableBytes: available, capacityBytes: capacity, effectiveLimitBytes: limit };
}

describe("scratch eviction ranking", () => {
  it("reclaims a large day-old working copy before a smaller week-old one, retaining recent scratch", () => {
    const tasks = [task("small", 200, 7), task("large", 2400, 1), task("recent", 9000, 0.01)];
    expect(rankScratchCandidates(tasks, new Map(), 10000, now, 3_600_000).map((t) => t.id)).toEqual(["large", "small"]);
  });

  it("prefers an over-budget workspace when age and size are otherwise equal", () => {
    const tasks = [task("light", 100, 1, { workspaceId: "light" }), task("heavy", 100, 1, { workspaceId: "heavy" })];
    expect(rankScratchCandidates(tasks, new Map([["light", 100], ["heavy", 800]]), 1000, now, 0)[0].id).toBe("heavy");
  });

  it("falls back to age for unknown sizes without making them outrank known large scratch", () => {
    const tasks = [task("new", null, 1), task("old", null, 7), task("known", 1000, 1)];
    expect(rankScratchCandidates(tasks, new Map(), 10000, now, 0).map((t) => t.id)).toEqual(["known", "old", "new"]);
  });

  it("clears finished and low-priority scratch before open scratch of the same size and age", () => {
    const tasks = [task("open", 100, 1), task("finished", 100, 1, { completion: "finished" }), task("low", 100, 1, { priority: "low", completion: "finished" })];
    expect(rankScratchCandidates(tasks, new Map(), 1000, now, 0).map((t) => t.id)).toEqual(["low", "finished", "open"]);
  });

  it("clears high-priority projects only after everything else, however large or old", () => {
    const tasks = [task("high", 1_000_000, 13, { priority: "high", completion: "finished" }), task("tiny", 1, 0.1)];
    expect(rankScratchCandidates(tasks, new Map(), 1000, now, 0).map((t) => t.id)).toEqual(["tiny", "high"]);
  });
});

describe("scratch idle expiry", () => {
  const policy = DEFAULT_SCRATCH_EVICTION_POLICY;
  it("expires by completion and priority", () => {
    expect(scratchIdleExpiryMs({ priority: "high", completion: "retired" }, policy)).toBe(0);
    expect(scratchIdleExpiryMs({ priority: "normal", completion: "finished" }, policy)).toBe(3 * DAY);
    expect(scratchIdleExpiryMs({ priority: "normal", completion: "open" }, policy)).toBe(14 * DAY);
    expect(scratchIdleExpiryMs({ priority: "low", completion: "finished" }, policy)).toBe(DAY);
    expect(scratchIdleExpiryMs({ priority: "low", completion: "open" }, policy)).toBe(3 * DAY);
    expect(scratchIdleExpiryMs({ priority: "high", completion: "finished" }, policy)).toBeNull();
  });

  it("keeps a disabled expiry disabled for low priority", () => {
    const disabled = { ...policy, finishedIdleDays: 0, maxIdleDays: 0 };
    expect(scratchIdleExpiryMs({ priority: "low", completion: "finished" }, disabled)).toBeNull();
    expect(scratchIdleExpiryMs({ priority: "low", completion: "open" }, disabled)).toBeNull();
  });
});

describe("scratch pressure", () => {
  it("uses the Admin budget and independently responds to physical free space", () => {
    expect(scratchNeedsCleanup(space(18, 82, 100, 20), 0.85)).toBe(true);
    expect(scratchNeedsCleanup(space(10, 10, 100, 100), 0.85)).toBe(true);
    expect(scratchNeedsCleanup(space(10, 90, 100, 20), 0.85)).toBe(false);
    expect(scratchNeedsCleanup(space(16, 84, 100, 20), 0.7)).toBe(true);
    expect(scratchNeedsCleanup(space(13, 87, 100, 20), 0.7)).toBe(false);
  });

  it("starts cleanup below the watermark when free space drops under the floor, and runs past it", () => {
    const policy = DEFAULT_SCRATCH_EVICTION_POLICY;
    const disk = space(31 * GB, 9 * GB, 40 * GB);
    const thresholds = scratchCleanupThresholds(disk, policy);
    expect(thresholds.start(disk)).toBe(true);
    expect(thresholds.keepGoing(space(27 * GB, 13 * GB, 40 * GB))).toBe(true);
    expect(thresholds.keepGoing(space(24 * GB, 16 * GB, 40 * GB))).toBe(false);
  });

  it("caps the floor at a quarter of a small budget", () => {
    const disk = space(10 * GB, 10 * GB, 20 * GB);
    expect(scratchCleanupThresholds(disk, DEFAULT_SCRATCH_EVICTION_POLICY).start(disk)).toBe(false);
  });
});
