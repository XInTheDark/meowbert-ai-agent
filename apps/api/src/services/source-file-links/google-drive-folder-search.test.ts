import { afterEach, describe, expect, it, vi } from "vitest";
import { searchGoogleDriveFolderSubtree, type GoogleDriveFolderSearchFilters } from "./google-drive-folder-search.js";
import { clearGoogleDriveSubtreeFolderCache } from "./google-drive-subtree-folders.js";

interface FakeDriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  modifiedTime?: string;
  shortcutDetails?: { targetId: string; targetMimeType: string };
}

const FOLDER = "application/vnd.google-apps.folder";

function filters(overrides: Partial<GoogleDriveFolderSearchFilters> = {}): GoogleDriveFolderSearchFilters {
  return {
    query: "budget",
    match: "full_text",
    fileTypes: [],
    modifiedAfter: null,
    modifiedBefore: null,
    extraQuery: null,
    orderBy: "relevance",
    limit: 25,
    ...overrides
  };
}

// A tiny Drive stand-in: folder listing honours `in parents`, and a "search" returns
// the non-folder files under the queried parents (plus anything a crafted query might leak).
function installFakeDrive(files: FakeDriveFile[], extraSearchHits: FakeDriveFile[] = []) {
  const queries: string[] = [];
  const fetchMock = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    const q = url.searchParams.get("q") ?? "";
    queries.push(q);
    const parentIds = [...q.matchAll(/'([^']+)' in parents/g)].map((match) => match[1]);
    const inParents = files.filter((file) => file.parents.some((id) => parentIds.includes(id)));
    let result: FakeDriveFile[];
    if (q.includes("mimeType = 'application/vnd.google-apps.shortcut'")) {
      result = inParents.filter((file) => file.mimeType === FOLDER || file.shortcutDetails);
    } else if (q.includes(" name = '")) {
      const name = /name = '([^']+)'/.exec(q)?.[1];
      result = inParents.filter((file) => file.mimeType === FOLDER && file.name === name);
    } else {
      result = [...inParents.filter((file) => file.mimeType !== FOLDER && !file.shortcutDetails), ...extraSearchHits];
      if (url.searchParams.get("orderBy") === "modifiedTime desc") {
        result.sort((left, right) => (right.modifiedTime ?? "").localeCompare(left.modifiedTime ?? ""));
      }
      const pageSize = Number(url.searchParams.get("pageSize"));
      return new Response(JSON.stringify({
        files: result.slice(0, pageSize),
        nextPageToken: result.length > pageSize ? "next" : undefined
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ files: result }), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { queries, fetchMock };
}

const tree: FakeDriveFile[] = [
  { id: "f-2024", name: "2024", mimeType: FOLDER, parents: ["root-folder"] },
  { id: "f-q1", name: "Q1", mimeType: FOLDER, parents: ["f-2024"] },
  { id: "f-elsewhere", name: "Elsewhere", mimeType: FOLDER, parents: ["unrelated"] },
  { id: "s-linked", name: "Linked", mimeType: "application/vnd.google-apps.shortcut", parents: ["root-folder"], shortcutDetails: { targetId: "f-elsewhere", targetMimeType: FOLDER } },
  { id: "doc-1", name: "Budget plan", mimeType: "application/vnd.google-apps.document", parents: ["f-q1"] },
  { id: "pdf-1", name: "a/b report.pdf", mimeType: "application/pdf", parents: ["root-folder"] },
  { id: "pdf-2", name: "shared.pdf", mimeType: "application/pdf", parents: ["f-elsewhere"] }
];

describe("searchGoogleDriveFolderSubtree", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearGoogleDriveSubtreeFolderCache();
  });

  it("finds files in nested folders and shortcut folders and maps them to mounted paths", async () => {
    installFakeDrive(tree);

    const result = await searchGoogleDriveFolderSubtree({ accessToken: "token", cacheScope: "link-1", depth: 0, rootItemId: "root-folder", subfolder: null, filters: filters() });

    expect(result.searchedFolderCount).toBe(4);
    expect(result.items.map((item) => item.path).sort()).toEqual([
      "2024/Q1/Budget plan.url",
      "Linked/shared.pdf",
      "a／b report.pdf"
    ]);
  });

  it("drops results outside the subtree even when a crafted extra query widens the Drive search", async () => {
    installFakeDrive(tree, [{ id: "leak", name: "secret.pdf", mimeType: "application/pdf", parents: ["unrelated"] }]);

    const result = await searchGoogleDriveFolderSubtree({
      accessToken: "token",
      cacheScope: "link-1",
      depth: 0,
      rootItemId: "root-folder",
      subfolder: null,
      filters: filters({ extraQuery: "x') or ('a' in parents" })
    });

    expect(result.items.map((item) => item.id)).not.toContain("leak");
  });

  it("starts from a subfolder and returns paths relative to it", async () => {
    const { queries } = installFakeDrive(tree);

    const result = await searchGoogleDriveFolderSubtree({ accessToken: "token", cacheScope: "link-1", depth: 0, rootItemId: "root-folder", subfolder: "2024", filters: filters() });

    expect(result.items.map((item) => item.path)).toEqual(["Q1/Budget plan.url"]);
    expect(queries.some((q) => q.includes("'root-folder' in parents") && q.includes("fullText"))).toBe(false);
  });

  it("limits the search to the requested number of folder levels", async () => {
    installFakeDrive(tree);
    const search = (depth: number) => searchGoogleDriveFolderSubtree({
      accessToken: "token", cacheScope: "link-1", depth, rootItemId: "root-folder", subfolder: null, filters: filters()
    });

    expect((await search(1)).items.map((item) => item.path)).toEqual(["a\uFF0Fb report.pdf"]);
    expect((await search(2)).items.map((item) => item.path).sort()).toEqual(["Linked/shared.pdf", "a\uFF0Fb report.pdf"]);
    expect((await search(3)).items.map((item) => item.path).sort()).toEqual([
      "2024/Q1/Budget plan.url",
      "Linked/shared.pdf",
      "a\uFF0Fb report.pdf"
    ]);
  });

  it("reuses the folder walk for repeat searches of the same link", async () => {
    const { queries } = installFakeDrive(tree);
    const search = (cacheScope: string) => searchGoogleDriveFolderSubtree({
      accessToken: "token", cacheScope, depth: 0, rootItemId: "root-folder", subfolder: null, filters: filters()
    });
    const folderListCount = () => queries.filter((q) => q.includes("mimeType = 'application/vnd.google-apps.shortcut'")).length;

    await search("link-1");
    const afterFirst = folderListCount();
    await search("link-1");
    expect(folderListCount()).toBe(afterFirst);
    await search("link-2");
    expect(folderListCount()).toBeGreaterThan(afterFirst);
  });

  it("rejects a missing subfolder", async () => {
    installFakeDrive(tree);

    await expect(searchGoogleDriveFolderSubtree({
      accessToken: "token",
      cacheScope: "link-1",
      depth: 0,
      rootItemId: "root-folder",
      subfolder: "2023",
      filters: filters()
    })).rejects.toThrow("Folder not found in Google Drive: 2023");
  });

  it("sorts merged results when an order is requested without full-text search", async () => {
    const files: FakeDriveFile[] = [
      { id: "old", name: "old.pdf", mimeType: "application/pdf", parents: ["root-folder"], modifiedTime: "2024-01-01T00:00:00.000Z" },
      { id: "new", name: "new.pdf", mimeType: "application/pdf", parents: ["root-folder"], modifiedTime: "2025-01-01T00:00:00.000Z" }
    ];
    installFakeDrive(files);

    const result = await searchGoogleDriveFolderSubtree({
      accessToken: "token",
      cacheScope: "link-1",
      depth: 0,
      rootItemId: "root-folder",
      subfolder: null,
      filters: filters({ query: null, orderBy: "modified_desc", limit: 1 })
    });

    expect(result.items.map((item) => item.id)).toEqual(["new"]);
    expect(result.hasMore).toBe(true);
  });

  it("refuses non-relevance ordering for full-text searches before calling Drive", async () => {
    const { fetchMock } = installFakeDrive(tree);

    await expect(searchGoogleDriveFolderSubtree({
      accessToken: "token",
      cacheScope: "link-1",
      depth: 0,
      rootItemId: "root-folder",
      subfolder: null,
      filters: filters({ orderBy: "name" })
    })).rejects.toThrow("relevance");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
