import { describe, expect, it } from "vitest";
import { normalizeModelSliderAgentIds } from "./model-slider";

describe("normalizeModelSliderAgentIds", () => {
  it("keeps ordered unique non-empty picker IDs", () => {
    expect(normalizeModelSliderAgentIds([" deep-think ", "default", "deep-think", ""])).toEqual([
      "deep-think",
      "default"
    ]);
  });

  it("returns an empty list for invalid values", () => {
    expect(normalizeModelSliderAgentIds({ ids: ["default"] })).toEqual([]);
  });
});
