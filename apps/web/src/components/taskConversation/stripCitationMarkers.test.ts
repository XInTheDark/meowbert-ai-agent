import { describe, expect, it } from "vitest";
import { stripCitationMarkers } from "./stripCitationMarkers";

describe("stripCitationMarkers", () => {
  it("removes complete web citation codes from ordinary text", () => {
    expect(stripCitationMarkers("First. citeturn2view3turn2view0 Next. citeturn1search0"))
      .toBe("First. Next.");
  });

  it("preserves incomplete markers and unrelated private-use text", () => {
    expect(stripCitationMarkers("Keep citeturn2view3 and other here."))
      .toBe("Keep citeturn2view3 and other here.");
  });
});
