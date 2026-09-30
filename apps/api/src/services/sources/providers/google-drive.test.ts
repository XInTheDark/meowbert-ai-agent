import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { googleDriveProviderClient } from "./google-drive.js";

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("googleDriveProviderClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches the full Drive without sending an orderBy parameter", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      files: [
        {
          id: "file-1",
          name: "Notes",
          mimeType: "text/plain",
          size: "12",
          modifiedTime: "2026-05-09T00:00:00.000Z",
          parents: ["root"]
        }
      ]
    }));

    const result = await googleDriveProviderClient.search({
      accessToken: "google-token",
      query: "notes",
      limit: 25
    });

    expect(result.items).toEqual([
      {
        id: "file-1",
        name: "Notes",
        displayPath: "My Drive/Notes",
        kind: "file",
        mimeType: "text/plain",
        sizeBytes: 12,
        modifiedAt: "2026-05-09T00:00:00.000Z",
        parentId: "root"
      }
    ]);

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("q")).toBe("trashed = false and (name contains 'notes' or (fullText contains 'notes'))");
    expect(requestUrl.searchParams.get("pageSize")).toBe("25");
    expect(requestUrl.searchParams.get("supportsAllDrives")).toBe("true");
    expect(requestUrl.searchParams.get("includeItemsFromAllDrives")).toBe("true");
    expect(requestUrl.searchParams.get("corpora")).toBe("allDrives");
    expect(requestUrl.searchParams.has("orderBy")).toBe(false);
  });

  it("matches a multi-word filename prefix and full-text terms", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({ files: [] }));

    await googleDriveProviderClient.search({
      accessToken: "google-token",
      query: "project idea",
      limit: 25
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("q")).toBe("trashed = false and (name contains 'project idea' or (fullText contains 'project' and fullText contains 'idea'))");
  });

  it("returns a pasted Google Docs URL through explicit path lookup", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      id: "doc-1",
      name: "Shared brief",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-05-09T00:00:00.000Z",
      parents: ["shared-folder"]
    }));

    const result = await googleDriveProviderClient.resolvePath({
      accessToken: "google-token",
      path: "https://docs.google.com/document/d/doc-1/edit?resourcekey=resource-1"
    });

    expect(result.items).toEqual([
      {
        id: "doc-1::resourceKey::resource-1",
        name: "Shared brief",
        displayPath: null,
        kind: "file",
        mimeType: "application/vnd.google-apps.document",
        sizeBytes: null,
        modifiedAt: "2026-05-09T00:00:00.000Z",
        parentId: "shared-folder"
      }
    ]);

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/drive/v3/files/doc-1");
    expect(requestUrl.searchParams.get("supportsAllDrives")).toBe("true");
    expect(requestUrl.searchParams.has("q")).toBe(false);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-goog-drive-resource-keys": "doc-1/resource-1"
    });
  });

  it("returns an empty URL path result when Google Drive cannot find the item", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      error: {
        message: "File not found"
      }
    }, 404));

    const result = await googleDriveProviderClient.resolvePath({
      accessToken: "google-token",
      path: "https://drive.google.com/file/d/missing-file/view"
    });

    expect(result.items).toEqual([]);
  });

  it("scopes search to the selected folder", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({ files: [] }));

    await googleDriveProviderClient.search({
      accessToken: "google-token",
      query: "notes",
      folderId: "folder-1",
      limit: 25
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("q")).toBe("trashed = false and 'folder-1' in parents and (name contains 'notes' or (fullText contains 'notes'))");
    expect(requestUrl.searchParams.get("corpora")).toBe("allDrives");
  });

  it("extracts Google Drive folder URLs for exact lookup", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      id: "folder-1",
      name: "Shared folder",
      mimeType: "application/vnd.google-apps.folder",
      modifiedTime: "2026-05-09T00:00:00.000Z"
    }));

    const result = await googleDriveProviderClient.resolvePath({
      accessToken: "google-token",
      path: "https://drive.google.com/drive/u/0/folders/folder-1"
    });

    expect(result.items).toEqual([
      {
        id: "folder-1",
        name: "Shared folder",
        displayPath: null,
        kind: "folder",
        mimeType: "application/vnd.google-apps.folder",
        sizeBytes: null,
        modifiedAt: "2026-05-09T00:00:00.000Z",
        parentId: null
      }
    ]);
  });

  it("walks slash-separated Google Drive paths by exact child name", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({
        files: [{
          id: "folder-1",
          name: "Projects",
          mimeType: "application/vnd.google-apps.folder",
          parents: ["root"]
        }]
      }))
      .mockResolvedValueOnce(createJsonResponse({
        files: [{
          id: "file-1",
          name: "brief.md",
          mimeType: "text/markdown",
          size: "33",
          modifiedTime: "2026-05-09T00:00:00.000Z",
          parents: ["folder-1"]
        }]
      }));

    const result = await googleDriveProviderClient.resolvePath({
      accessToken: "google-token",
      path: "Projects/brief.md"
    });

    expect(result.items).toEqual([
      {
        id: "file-1",
        name: "brief.md",
        displayPath: "My Drive/Projects/brief.md",
        kind: "file",
        mimeType: "text/markdown",
        sizeBytes: 33,
        modifiedAt: "2026-05-09T00:00:00.000Z",
        parentId: "folder-1"
      }
    ]);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get("q")).toBe("trashed = false and 'root' in parents and name = 'Projects'");
    expect(new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get("q")).toBe("trashed = false and 'folder-1' in parents and name = 'brief.md'");
  });

  it("uses resource keys when downloading URL-derived item IDs", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({
        id: "file-1",
        name: "Shared PDF",
        mimeType: "application/pdf",
        size: "12",
        modifiedTime: "2026-05-09T00:00:00.000Z"
      }))
      .mockResolvedValueOnce(new Response("content", {
        status: 200,
        headers: { "content-type": "application/pdf" }
      }));

    const result = await googleDriveProviderClient.downloadFile({
      accessToken: "google-token",
      itemId: "file-1::resourceKey::resource-1"
    });

    expect(result.fileName).toBe("Shared PDF");

    const metadataUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(metadataUrl.pathname).toBe("/drive/v3/files/file-1");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-goog-drive-resource-keys": "file-1/resource-1"
    });

    const downloadUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(downloadUrl.pathname).toBe("/drive/v3/files/file-1");
    expect(downloadUrl.searchParams.get("supportsAllDrives")).toBe("true");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      "x-goog-drive-resource-keys": "file-1/resource-1"
    });
  });

  it("keeps deterministic ordering for folder browsing", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ files: [] }))
      .mockResolvedValueOnce(createJsonResponse({
        id: "folder-1",
        name: "Folder",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"]
      }));

    await googleDriveProviderClient.browse({
      accessToken: "google-token",
      folderId: "folder-1",
      limit: 50
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("q")).toBe("trashed = false and 'folder-1' in parents");
    expect(requestUrl.searchParams.get("orderBy")).toBe("folder,name_natural");
    expect(requestUrl.searchParams.get("supportsAllDrives")).toBe("true");
    expect(requestUrl.searchParams.get("includeItemsFromAllDrives")).toBe("true");
  });

  it("resolves parent folder paths for nested search results", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({
        files: [
          {
            id: "file-2",
            name: "report.pdf",
            mimeType: "application/pdf",
            size: "1024",
            modifiedTime: "2026-05-09T00:00:00.000Z",
            parents: ["folder-sub"]
          }
        ]
      }))
      .mockResolvedValueOnce(createJsonResponse({
        id: "folder-sub",
        name: "Reports",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["folder-root-parent"]
      }))
      .mockResolvedValueOnce(createJsonResponse({
        id: "folder-root-parent",
        name: "Finance",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"]
      }));

    const result = await googleDriveProviderClient.search({
      accessToken: "google-token",
      query: "report",
      limit: 10
    });

    expect(result.items[0]?.displayPath).toBe("My Drive/Finance/Reports/report.pdf");
  });
});

describe("Google Drive verified paths", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubItems(items: Record<string, unknown>) {
    const fetchMock = vi.fn(async (url: string) => {
      const pathname = new URL(url).pathname;
      const id = `${pathname.includes("/drives/") ? "drive:" : ""}${pathname.split("/").pop()!}`;
      return id in items ? createJsonResponse(items[id]) : createJsonResponse({ error: "Not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("resolves the full ancestry of an open?id link using the real My Drive root ID", async () => {
    stubItems({
      notes: { id: "notes", name: "Notes", parents: ["project"] },
      project: { id: "project", name: "Project", parents: ["personal-root"] },
      "personal-root": { id: "personal-root", name: "My Drive" },
      root: { id: "personal-root", name: "My Drive" }
    });
    const result = await googleDriveProviderClient.resolvePath({ accessToken: "token", path: "https://drive.google.com/open?id=notes" });
    expect(result.items[0]).toMatchObject({ name: "Notes", displayPath: "My Drive/Project/Notes" });
  });

  it("uses the shared drive name without adding My Drive", async () => {
    stubItems({
      notes: { id: "notes", name: "Notes", parents: ["project"], driveId: "team" },
      project: { id: "project", name: "Project", parents: ["team"], driveId: "team" },
      team: { id: "team", name: "Drive", driveId: "team" },
      "drive:team": { id: "team", name: "Engineering" }
    });
    const result = await googleDriveProviderClient.resolvePath({ accessToken: "token", path: "https://drive.google.com/open?id=notes" });
    expect(result.items[0]?.displayPath).toBe("Engineering/Project/Notes");
  });

  it("keeps the item accessible without claiming a path when a parent is inaccessible", async () => {
    stubItems({ notes: { id: "notes", name: "Notes", parents: ["hidden"] } });
    const result = await googleDriveProviderClient.resolvePath({ accessToken: "token", path: "https://drive.google.com/open?id=notes" });
    expect(result.items[0]).toMatchObject({ name: "Notes", displayPath: null });
  });

  it("does not assume a parentless shared item belongs to My Drive", async () => {
    stubItems({ notes: { id: "notes", name: "Notes" }, root: { id: "personal-root", name: "My Drive" } });
    const result = await googleDriveProviderClient.resolvePath({ accessToken: "token", path: "https://drive.google.com/open?id=notes" });
    expect(result.items[0]?.displayPath).toBeNull();
  });

  it("stops cyclic ancestry without publishing a fabricated path", async () => {
    const fetchMock = stubItems({
      notes: { id: "notes", name: "Notes", parents: ["project"] },
      project: { id: "project", name: "Project", parents: ["notes"] }
    });
    const result = await googleDriveProviderClient.resolvePath({ accessToken: "token", path: "https://drive.google.com/open?id=notes" });
    expect(result.items[0]?.displayPath).toBeNull();
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("includes ancestors above the starting folder for relative path lookup", async () => {
    const fetchMock = stubItems({
      files: { files: [{ id: "notes", name: "Notes", parents: ["project"] }] },
      project: { id: "project", name: "Project", parents: ["team"], driveId: "team" },
      team: { id: "team", name: "Drive", driveId: "team" },
      "drive:team": { id: "team", name: "Engineering" }
    });
    const result = await googleDriveProviderClient.resolvePath({ accessToken: "token", path: "Notes", folderId: "project" });
    expect(result.items[0]?.displayPath).toBe("Engineering/Project/Notes");
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("q")).toContain("'project' in parents");
  });
});
