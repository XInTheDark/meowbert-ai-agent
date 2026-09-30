import { describe, expect, it } from "vitest";
import { buildRibbonSegments } from "./SourceFilePickerPathRibbon";
import type { SourceFileEntry } from "../../sources/sourceTypes";

describe("SourceFilePickerPathRibbon", () => {
  it("builds browse breadcrumb segments when no entry is selected", () => {
    const breadcrumbs = [
      { id: null, name: "My Drive" },
      { id: "f-1", name: "Projects" },
      { id: "f-2", name: "Alpha" }
    ];

    const result = buildRibbonSegments("Google Drive", "browse", breadcrumbs, null);
    expect(result.icon).toBe("folder");
    expect(result.segments).toEqual([
      { name: "My Drive", folderId: null, isClickable: true, isLast: false },
      { name: "Projects", folderId: "f-1", isClickable: true, isLast: false },
      { name: "Alpha", folderId: "f-2", isClickable: false, isLast: true }
    ]);
  });

  it("builds file path segments from displayPath when an entry is selected", () => {
    const breadcrumbs = [{ id: null, name: "My Drive" }];
    const selectedEntry: SourceFileEntry = {
      id: "file-1",
      name: "spec.md",
      displayPath: "My Drive/Projects/Alpha/spec.md",
      kind: "file",
      mimeType: "text/markdown",
      sizeBytes: 100,
      modifiedAt: null,
      parentId: "f-2"
    };

    const result = buildRibbonSegments("Google Drive", "search", breadcrumbs, selectedEntry);
    expect(result.icon).toBe("file");
    expect(result.segments).toEqual([
      { name: "My Drive", isClickable: false, isLast: false },
      { name: "Projects", folderId: undefined, isClickable: false, isLast: false },
      { name: "Alpha", folderId: undefined, isClickable: false, isLast: false },
      { name: "spec.md", folderId: undefined, isClickable: false, isLast: true }
    ]);
  });

  it("builds folder path segments from breadcrumbs when a folder is selected without displayPath", () => {
    const breadcrumbs = [
      { id: null, name: "My Drive" },
      { id: "f-1", name: "Projects" }
    ];
    const selectedFolder: SourceFileEntry = {
      id: "f-2",
      name: "Alpha",
      kind: "folder",
      mimeType: "application/vnd.google-apps.folder",
      sizeBytes: null,
      modifiedAt: null,
      parentId: "f-1"
    };

    const result = buildRibbonSegments("Google Drive", "browse", breadcrumbs, selectedFolder);
    expect(result.icon).toBe("folder");
    expect(result.segments).toEqual([
      { name: "My Drive", folderId: null, isClickable: true, isLast: false },
      { name: "Projects", folderId: "f-1", isClickable: true, isLast: false },
      { name: "Alpha", isClickable: false, isLast: true }
    ]);
  });

  it("shows search status segment when in search mode without selection", () => {
    const breadcrumbs = [{ id: null, name: "My Drive" }];
    const result = buildRibbonSegments("Google Drive", "search", breadcrumbs, null, "contract");
    expect(result.icon).toBe("search");
    expect(result.segments).toEqual([
      { name: "My Drive", folderId: null, isClickable: true, isLast: false },
      { name: 'Search: "contract"', isClickable: false, isLast: true }
    ]);
  });
});

it("does not attach the current browse location to a path result with unknown ancestry", () => {
  const result = buildRibbonSegments("Google Drive", "search", [{ id: null, name: "My Drive" }], {
    id: "shared", name: "Notes", kind: "folder", parentId: null,
    displayPath: null, mimeType: null, sizeBytes: null, modifiedAt: null
  });
  expect(result.segments.map((segment) => segment.name)).toEqual(["Location unavailable", "Notes"]);
  expect(result.segments.every((segment) => !segment.isClickable)).toBe(true);
});

it("does not link a shared-drive path root to My Drive", () => {
  const result = buildRibbonSegments("Google Drive", "search", [{ id: null, name: "My Drive" }], {
    id: "shared", name: "Notes", kind: "folder", parentId: "project",
    displayPath: "Engineering/Project/Notes", mimeType: null, sizeBytes: null, modifiedAt: null
  });
  expect(result.segments.map((segment) => segment.name)).toEqual(["Engineering", "Project", "Notes"]);
  expect(result.segments.every((segment) => !segment.isClickable)).toBe(true);
});
