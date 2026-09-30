import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(async () => ({ rows: [] }))
}));

import { query } from "../../lib/db.js";
import { markTaskArtifacts, unmarkTaskArtifacts } from "./artifacts.js";

describe("markTaskArtifacts", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    mockedQuery.mockClear();
  });

  it("replaces existing explicit artifact rows for the same paths and inserts fresh artifact rows", async () => {
    await markTaskArtifacts("task-1", [
      {
        relativePath: "build/report.pdf",
        size: 123
      },
      {
        relativePath: "images/preview.png",
        size: 456
      }
    ]);

    expect(mockedQuery).toHaveBeenNthCalledWith(1, expect.stringContaining("DELETE FROM task_artifacts"), [
      "task-1",
      ["build/report.pdf", "images/preview.png"]
    ]);
    expect(mockedQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("VALUES ($1, 'artifact'"), [
      "task-1",
      "build/report.pdf",
      123
    ]);
    expect(mockedQuery).toHaveBeenNthCalledWith(3, expect.stringContaining("VALUES ($1, 'artifact'"), [
      "task-1",
      "images/preview.png",
      456
    ]);
  });

  it("does nothing when no artifacts are provided", async () => {
    await markTaskArtifacts("task-1", []);

    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it("removes explicit artifact rows for the provided paths", async () => {
    await unmarkTaskArtifacts("task-1", ["build/report.pdf", "images/preview.png"]);

    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM task_artifacts"), [
      "task-1",
      ["build/report.pdf", "images/preview.png"]
    ]);
  });

  it("does nothing when no artifact paths are provided for removal", async () => {
    await unmarkTaskArtifacts("task-1", []);

    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
