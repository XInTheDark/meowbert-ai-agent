import { describe, expect, it } from "vitest";
import { buildThreadHint } from "./prompts.js";

describe("Context Management V2 continuity hints", () => {
  it("caps the deterministic continuity hint at 4,000 UTF-8 bytes", () => {
    const hint = buildThreadHint({
      continuity: "é".repeat(4_000),
      index: [{ path: "other.md", size: 20, updatedAt: "2026-09-04T00:00:00Z" }]
    });

    expect(Buffer.byteLength(hint ?? "", "utf8")).toBeLessThanOrEqual(4_000);
  });
});
