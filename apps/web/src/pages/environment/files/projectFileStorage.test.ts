import { describe, expect, it } from "vitest";
import { getProjectFileStorageMetrics } from "./projectFileStorage";

describe("getProjectFileStorageMetrics", () => {
  it("formats limited storage and clamps the meter", () => {
    const metrics = getProjectFileStorageMetrics({
      usedBytes: 150,
      limitBytes: 100,
      availableBytes: -50,
      usagePercent: 150,
      isOverLimit: true
    });

    expect(metrics.hasLimit).toBe(true);
    expect(metrics.usagePercent).toBe(150);
    expect(metrics.meterPercent).toBe(100);
    expect(metrics.remainingBytes).toBe(-50);
    expect(metrics.tooltip).toContain("50 B over limit");
  });

  it("describes storage without a configured limit", () => {
    expect(getProjectFileStorageMetrics({
      usedBytes: 1024,
      limitBytes: null,
      availableBytes: null,
      usagePercent: null,
      isOverLimit: false
    }).label).toBe("Used 1.0 KB (no limit)");
  });
});
