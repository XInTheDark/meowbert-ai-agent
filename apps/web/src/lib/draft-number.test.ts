import { describe, expect, it } from "vitest";
import {
  clampDraftNumberValue,
  formatDraftNumberValue,
  isDraftNumberWithinBounds,
  parseDraftNumberValue
} from "./draft-number";

describe("draft-number helpers", () => {
  it("formats integer values without decimals", () => {
    expect(formatDraftNumberValue(12, "integer")).toBe("12");
    expect(formatDraftNumberValue(12.9, "integer")).toBe("12");
  });

  it("parses integer drafts only when they are whole numbers", () => {
    expect(parseDraftNumberValue("", "integer")).toBeNull();
    expect(parseDraftNumberValue("12", "integer")).toBe(12);
    expect(parseDraftNumberValue("12.5", "integer")).toBeNull();
  });

  it("allows decimal drafts for decimal mode", () => {
    expect(parseDraftNumberValue("0.25", "decimal")).toBe(0.25);
  });

  it("checks bounds before committing", () => {
    expect(isDraftNumberWithinBounds({ value: 3, min: 1, max: 5 })).toBe(true);
    expect(isDraftNumberWithinBounds({ value: 0, min: 1 })).toBe(false);
    expect(isDraftNumberWithinBounds({ value: 6, max: 5 })).toBe(false);
  });

  it("clamps values on blur/commit", () => {
    expect(clampDraftNumberValue({ value: 0, mode: "integer", min: 1 })).toBe(1);
    expect(clampDraftNumberValue({ value: 9, mode: "integer", max: 5 })).toBe(5);
    expect(clampDraftNumberValue({ value: 4.9, mode: "integer" })).toBe(4);
  });
});
