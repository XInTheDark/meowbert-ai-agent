import { describe, expect, it } from "vitest";
import { buildComputerTypeSummary, getPostActionSettleDelayMs } from "./computerActionUtils";

describe("buildComputerTypeSummary", () => {
  it("includes the typed text preview for short inputs", () => {
    expect(buildComputerTypeSummary("wiki")).toBe('Typed "wiki" (4 characters).');
  });

  it("truncates long previews while preserving the full character count", () => {
    const text = "a".repeat(80);
    expect(buildComputerTypeSummary(text)).toBe(`Typed "${"a".repeat(57)}..." (80 characters).`);
  });
});

describe("getPostActionSettleDelayMs", () => {
  it("waits briefly after typing so the follow-up screenshot can catch up", () => {
    expect(getPostActionSettleDelayMs("computer_type", { text: "wiki" })).toBe(200);
    expect(getPostActionSettleDelayMs("computer_type", { text: "a".repeat(80) })).toBe(650);
  });

  it("applies a smaller settle delay to key-based actions only", () => {
    expect(getPostActionSettleDelayMs("computer_key", { keys: "enter" })).toBe(180);
    expect(getPostActionSettleDelayMs("computer_hold_key", { key: "shift" })).toBe(180);
    expect(getPostActionSettleDelayMs("computer_left_click", { x: 1, y: 2 })).toBe(0);
  });
});
