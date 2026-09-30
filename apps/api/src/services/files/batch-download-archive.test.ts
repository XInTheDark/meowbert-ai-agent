import { describe, expect, it } from "vitest";
import { buildBatchDownloadArchivePath } from "./batch-download-archive.js";

describe("buildBatchDownloadArchivePath", () => {
  it("keeps root-level selections rooted at the workspace or environment root", () => {
    expect(buildBatchDownloadArchivePath({
      currentDirectory: "",
      targetRelativePath: ".meowbert/task-runs/run-1/specs/plan.md"
    })).toBe(".meowbert/task-runs/run-1/specs/plan.md");
  });

  it("rebases selections to the current viewed directory name", () => {
    expect(buildBatchDownloadArchivePath({
      currentDirectory: ".meowbert/task-runs/run-1/specs",
      targetRelativePath: ".meowbert/task-runs/run-1/specs/plan.md"
    })).toBe("specs/plan.md");
  });

  it("keeps nested directories under the current viewed directory", () => {
    expect(buildBatchDownloadArchivePath({
      currentDirectory: ".meowbert/task-runs/run-1/specs",
      targetRelativePath: ".meowbert/task-runs/run-1/specs/subdir"
    })).toBe("specs/subdir");
  });

  it("rejects selections outside the current viewed directory", () => {
    expect(() => buildBatchDownloadArchivePath({
      currentDirectory: ".meowbert/task-runs/run-1/specs",
      targetRelativePath: ".meowbert/task-runs/run-1/notes/todo.md"
    })).toThrow("Selected path is outside the current directory");
  });
});
