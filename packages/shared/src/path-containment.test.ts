import { describe, expect, it } from "vitest";
import { isWithinPath } from "./fs-guards.js";

describe("isWithinPath", () => {
  it("allows filesystem roots and filenames beginning with two dots", () => {
    expect(isWithinPath("/", "/tmp/page.jpg")).toBe(true);
    expect(isWithinPath("/task", "/task/..preview.jpg")).toBe(true);
    expect(isWithinPath("/task", "/task")).toBe(true);
  });

  it("rejects traversal and sibling prefixes", () => {
    expect(isWithinPath("/task", "/task/../secret")).toBe(false);
    expect(isWithinPath("/task", "/task-other/page.jpg")).toBe(false);
  });
});
