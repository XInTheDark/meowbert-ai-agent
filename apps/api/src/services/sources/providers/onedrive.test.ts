import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onedriveProviderClient } from "./onedrive.js";

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("onedriveProviderClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches from root when no folder is selected", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({ value: [] }));

    await onedriveProviderClient.search({
      accessToken: "onedrive-token",
      query: "notes",
      limit: 25
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/v1.0/me/drive/root/search(q='notes')");
    expect(requestUrl.searchParams.get("$top")).toBe("25");
  });

  it("searches from the selected folder when one is active", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({ value: [] }));

    await onedriveProviderClient.search({
      accessToken: "onedrive-token",
      query: "notes",
      folderId: "folder-1",
      limit: 25
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/v1.0/me/drive/items/folder-1/search(q='notes')");
  });

  it("resolves root-relative paths explicitly", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      id: "file-1",
      name: "notes.txt",
      size: 12,
      lastModifiedDateTime: "2026-05-09T00:00:00.000Z",
      parentReference: {
        id: "folder-1",
        path: "/drive/root:/Projects"
      },
      file: {
        mimeType: "text/plain"
      }
    }));

    const result = await onedriveProviderClient.resolvePath({
      accessToken: "onedrive-token",
      path: "Projects/notes.txt"
    });

    expect(result.items).toEqual([
      {
        id: "file-1",
        name: "notes.txt",
        displayPath: "OneDrive/Projects/notes.txt",
        kind: "file",
        mimeType: "text/plain",
        sizeBytes: 12,
        modifiedAt: "2026-05-09T00:00:00.000Z",
        parentId: "folder-1"
      }
    ]);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/v1.0/me/drive/root:/Projects/notes.txt");
  });

  it("resolves paths relative to the selected folder", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      id: "file-2",
      name: "notes.txt",
      parentReference: { id: "folder-1" },
      file: { mimeType: "text/plain" }
    }));

    await onedriveProviderClient.resolvePath({
      accessToken: "onedrive-token",
      path: "notes.txt",
      folderId: "folder-1"
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toBe("/v1.0/me/drive/items/folder-1:/notes.txt");
  });
});
