import { describe, expect, it } from "vitest";
import { assertReadablePath, assertTaskWritePath } from "./fs-guards.js";

describe("fs guards", () => {
  const paths = {
    taskDir: "/tmp/work/task",
    envRoot: "/tmp/work/env"
  };

  it("allows writes within task directory", () => {
    expect(() => assertTaskWritePath(paths, "/tmp/work/task/output.txt")).not.toThrow();
  });

  it("rejects writes outside task directory", () => {
    expect(() => assertTaskWritePath(paths, "/tmp/work/env/notes.txt")).toThrow(/denied/);
  });

  it("allows reads from environment root", () => {
    expect(() => assertReadablePath(paths, "/tmp/work/env/readme.md")).not.toThrow();
  });
});
