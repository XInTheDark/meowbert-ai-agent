import { describe, expect, it } from "vitest";
import { calculateContextUsagePercent, selectPreferredContextUsage } from "./context-usage.js";

describe("selectPreferredContextUsage", () => {
  it("prefers actual usage even when a newer estimate is available", () => {
    expect(
      selectPreferredContextUsage(
        {
          source: "actual",
          createdAt: "2026-03-20T10:00:00.000Z"
        },
        {
          source: "estimate",
          createdAt: "2026-03-20T11:00:00.000Z"
        }
      )
    ).toEqual({
      source: "actual",
      createdAt: "2026-03-20T10:00:00.000Z"
    });
  });

  it("picks the newest actual usage when both readings are actual", () => {
    expect(
      selectPreferredContextUsage(
        {
          source: "actual",
          createdAt: "2026-03-20T10:00:00.000Z"
        },
        {
          source: "actual",
          createdAt: "2026-03-20T11:00:00.000Z"
        }
      )
    ).toEqual({
      source: "actual",
      createdAt: "2026-03-20T11:00:00.000Z"
    });
  });

  it("falls back to the newest estimate when no actual reading exists", () => {
    expect(
      selectPreferredContextUsage(
        {
          source: "estimate",
          createdAt: "2026-03-20T10:00:00.000Z"
        },
        {
          source: "estimate",
          createdAt: "2026-03-20T11:00:00.000Z"
        }
      )
    ).toEqual({
      source: "estimate",
      createdAt: "2026-03-20T11:00:00.000Z"
    });
  });
});

describe("calculateContextUsagePercent", () => {
  it("uses the same rounded and clamped percentage for UI and tool-output context", () => {
    expect(calculateContextUsagePercent(128_001, 256_000)).toBe(50);
    expect(calculateContextUsagePercent(300_000, 256_000)).toBe(100);
    expect(calculateContextUsagePercent(-1, 256_000)).toBe(0);
  });
});
