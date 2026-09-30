import { describe, expect, it } from "vitest";
import type { ProjectCleanupPlanResponse } from "../../../lib/types";
import { buildCleanupPlanQuery, buildDefaultCleanupSelection, EMPTY_CLEANUP_FILTERS } from "./projectFileCleanup";

describe("project file cleanup helpers", () => {
  it("builds cleanup filters with MiB values converted to bytes", () => {
    expect(buildCleanupPlanQuery(40, {
      modifiedAfter: "2026-01-01",
      modifiedBefore: "",
      minSizeMb: "1.5",
      maxSizeMb: "3"
    })).toBe("targetPercent=40&modifiedAfter=2026-01-01&minSizeBytes=1572864&maxSizeBytes=3145728");
    expect(buildCleanupPlanQuery(50, EMPTY_CLEANUP_FILTERS)).toBe("targetPercent=50");
  });

  it("selects suggestions until the cleanup target is reached", () => {
    const plan = {
      targetBytes: 100,
      suggestions: [
        { relativePath: "a", sizeBytes: 60 },
        { relativePath: "b", sizeBytes: 50 },
        { relativePath: "c", sizeBytes: 30 }
      ]
    } as ProjectCleanupPlanResponse;
    expect(Array.from(buildDefaultCleanupSelection(plan))).toEqual(["a", "b"]);
  });
});
