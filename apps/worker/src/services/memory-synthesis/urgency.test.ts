import { describe, expect, it } from "vitest";
import {
  calculateMemorySynthesisUrgency,
  calculateSessionWeight,
  calculateUserSessionsWeightedCount,
  MEMORY_SYNTHESIS_MIN_REFRESH_INTERVAL_MS,
  MEMORY_SYNTHESIS_URGENCY_THRESHOLD
} from "./urgency.js";

const now = new Date("2026-07-13T12:00:00.000Z");

function score(input: Partial<Parameters<typeof calculateMemorySynthesisUrgency>[0]>) {
  return calculateMemorySynthesisUrgency({
    now,
    lastRefreshAt: "2026-07-13T06:00:00.000Z",
    earliestDeltaAt: "2026-07-13T06:05:00.000Z",
    userSessionsWeightedCount: 0.29,
    deltaCharCount: 100,
    ...input
  });
}

describe("Memory synthesis urgency", () => {
  it("uses a three-hour minimum automatic refresh interval", () => {
    expect(MEMORY_SYNTHESIS_MIN_REFRESH_INTERVAL_MS).toBe(3 * 60 * 60 * 1_000);
  });

  describe("calculateSessionWeight", () => {
    it("returns 0 for 0 tokens", () => {
      expect(calculateSessionWeight(0)).toBe(0);
    });

    it("weights a 40k token quick session at ~0.29", () => {
      expect(calculateSessionWeight(40_000)).toBeCloseTo(0.289, 2);
    });

    it("weights a 400k token standard session at 1.00", () => {
      expect(calculateSessionWeight(400_000)).toBeCloseTo(1.00, 2);
    });

    it("weights a 1.5M token active session at ~1.52", () => {
      expect(calculateSessionWeight(1_500_000)).toBeCloseTo(1.52, 2);
    });

    it("weights a 3.5M token extensive session at ~1.87", () => {
      expect(calculateSessionWeight(3_500_000)).toBeCloseTo(1.87, 2);
    });

    it("caps session weight at 2.5", () => {
      expect(calculateSessionWeight(20_000_000)).toBe(2.5);
    });
  });

  describe("calculateUserSessionsWeightedCount", () => {
    it("sums session weights for numeric and object inputs", () => {
      const sum = calculateUserSessionsWeightedCount([400_000, { tokens: 400_000 }]);
      expect(sum).toBeCloseTo(2.0, 2);
    });
  });

  it("increases with elapsed time, session token weights, and delta character size", () => {
    const baseline = score({});
    expect(score({ lastRefreshAt: "2026-07-12T12:00:00.000Z" })).toBeGreaterThan(baseline);
    expect(score({ userSessionsWeightedCount: 2.0 })).toBeGreaterThan(baseline);
    expect(score({ deltaCharCount: 26_000 })).toBeGreaterThan(baseline);
  });

  it("triggers around day 3 for light sporadic work", () => {
    const day1Score = score({
      lastRefreshAt: "2026-07-12T12:00:00.000Z",
      userSessionsWeightedCount: 0.29,
      deltaCharCount: 3_000
    });
    expect(day1Score).toBeLessThan(MEMORY_SYNTHESIS_URGENCY_THRESHOLD);

    const day3Score = score({
      lastRefreshAt: "2026-07-10T12:00:00.000Z",
      userSessionsWeightedCount: 0.29,
      deltaCharCount: 3_000
    });
    expect(day3Score).toBeGreaterThanOrEqual(MEMORY_SYNTHESIS_URGENCY_THRESHOLD);
  });

  it("triggers within 1 to 1.5 days for moderate work", () => {
    const day1ModerateScore = score({
      lastRefreshAt: "2026-07-12T12:00:00.000Z",
      userSessionsWeightedCount: 2.0,
      deltaCharCount: 15_000
    });
    expect(day1ModerateScore).toBeGreaterThanOrEqual(MEMORY_SYNTHESIS_URGENCY_THRESHOLD);
  });

  it("triggers at ~8 hours for active moderate sessions", () => {
    const eightHourActiveScore = score({
      lastRefreshAt: "2026-07-13T04:00:00.000Z",
      userSessionsWeightedCount: 2.76,
      deltaCharCount: 20_000
    });
    expect(eightHourActiveScore).toBeGreaterThanOrEqual(MEMORY_SYNTHESIS_URGENCY_THRESHOLD);
  });

  it("triggers after an extensive multi-million token session completes", () => {
    const extensiveTaskScore = score({
      lastRefreshAt: "2026-07-13T08:00:00.000Z",
      userSessionsWeightedCount: 1.88,
      deltaCharCount: 26_000
    });
    expect(extensiveTaskScore).toBeGreaterThanOrEqual(MEMORY_SYNTHESIS_URGENCY_THRESHOLD);
  });
});

