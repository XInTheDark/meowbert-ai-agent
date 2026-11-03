import { describe, expect, it } from "vitest";
import { buildThreadHint } from "./prompts.js";

const index = [{ path: "other.md", size: 20, updatedAt: "2026-09-04T00:00:00Z" }];

describe("Context Management V2 continuity hints", () => {
  it("includes a short checkpoint whole, under the path the agent should write to", () => {
    const hint = buildThreadHint({ continuity: "Next: ship it", index });
    expect(hint).toContain("continuity.md:\nNext: ship it");
    expect(hint).not.toContain("notes/continuity.md");
    expect(hint).not.toContain("[truncated");
  });

  it("marks a truncated checkpoint and still lists the other notes", () => {
    const hint = buildThreadHint({ continuity: "é".repeat(20_000), index }) ?? "";
    expect(hint).toContain("[truncated at 16000 bytes");
    expect(hint).toContain("other.md");
    expect(Buffer.byteLength(hint, "utf8")).toBeLessThanOrEqual(20_200);
  });

  it("is empty without notes", () => {
    expect(buildThreadHint({ continuity: null, index: [] })).toBeNull();
  });
});
