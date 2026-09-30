import { describe, expect, it } from "vitest";
import {
  buildViewerUploadQuery,
  planViewerUploads,
  selectionIncludesFolder
} from "./fileUploadPlanning";

function createUploadFile(name: string, webkitRelativePath?: string): File {
  const file = new File(["content"], name, { type: "text/plain" });

  if (webkitRelativePath) {
    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      value: webkitRelativePath
    });
  }

  return file;
}

describe("fileUploadPlanning", () => {
  it("plans direct file uploads in the current directory", () => {
    const uploads = planViewerUploads("docs/reference", [createUploadFile("notes.md")]);

    expect(uploads).toEqual([
      expect.objectContaining({
        label: "notes.md",
        relativePath: "notes.md",
        targetPath: "docs/reference",
        createDirectories: false
      })
    ]);
    expect(selectionIncludesFolder(uploads)).toBe(false);
    expect(buildViewerUploadQuery(uploads[0])).toBe("?path=docs%2Freference");
  });

  it("preserves nested folder structure under the current directory", () => {
    const uploads = planViewerUploads("workspace", [
      createUploadFile("index.ts", "project/src/index.ts")
    ]);

    expect(uploads).toEqual([
      expect.objectContaining({
        label: "project/src/index.ts",
        relativePath: "project/src/index.ts",
        targetPath: "workspace/project/src",
        createDirectories: true
      })
    ]);
    expect(selectionIncludesFolder(uploads)).toBe(true);
    expect(buildViewerUploadQuery(uploads[0])).toBe("?path=workspace%2Fproject%2Fsrc&createDirectories=true");
  });

  it("normalizes slash-heavy inputs when combining upload paths", () => {
    const uploads = planViewerUploads("/logs//2026/", [
      createUploadFile("events.json", "captures\\\\march/events.json")
    ]);

    expect(uploads).toEqual([
      expect.objectContaining({
        label: "captures/march/events.json",
        relativePath: "captures/march/events.json",
        targetPath: "logs/2026/captures/march",
        createDirectories: true
      })
    ]);
  });
});
