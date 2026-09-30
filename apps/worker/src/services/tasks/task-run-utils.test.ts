import { describe, expect, it } from "vitest";
import { shouldResolveContinuationBranch } from "./task-run-utils.js";

describe("shouldResolveContinuationBranch", () => {
  it("does not force user-branch continuation for recurring auto runs", () => {
    expect(shouldResolveContinuationBranch("scheduled_auto")).toBe(false);
    expect(shouldResolveContinuationBranch("infinite_auto")).toBe(false);
  });

  it("keeps branch continuation behavior for interactive and recovery modes", () => {
    expect(shouldResolveContinuationBranch("default")).toBe(true);
    expect(shouldResolveContinuationBranch("compact_only")).toBe(true);
    expect(shouldResolveContinuationBranch("infinite_checkin")).toBe(true);
    expect(shouldResolveContinuationBranch(undefined)).toBe(true);
  });
});
