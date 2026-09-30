import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockedDelay,
  mockedResolveWorkspaceSourceAccess,
  mockedGetSourceCatalogEntry,
  mockedSourceConnectionCanWrite
} = vi.hoisted(() => ({
  mockedDelay: vi.fn(async () => undefined),
  mockedResolveWorkspaceSourceAccess: vi.fn(),
  mockedGetSourceCatalogEntry: vi.fn(),
  mockedSourceConnectionCanWrite: vi.fn()
}));

vi.mock("node:timers/promises", () => ({
  setTimeout: mockedDelay
}));

vi.mock("../sources/source-access.js", () => ({
  resolveWorkspaceSourceAccess: mockedResolveWorkspaceSourceAccess
}));

vi.mock("../sources/source-catalog.js", () => ({
  getSourceCatalogEntry: mockedGetSourceCatalogEntry
}));

vi.mock("../sources/workspace-source-connections.js", () => ({
  sourceConnectionCanWrite: mockedSourceConnectionCanWrite
}));

import {
  SourceFileLinkRemoteLockedError,
  uploadOneDriveRemoteFile
} from "./onedrive-remote.js";

function createJsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createRemoteFilePayload(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "remote-1",
    name: "report.docx",
    size: 128,
    lastModifiedDateTime: "2026-04-01T00:00:00.000Z",
    webUrl: "https://example.com/report.docx",
    eTag: "etag-2",
    cTag: "ctag-2",
    file: {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    },
    ...(overrides ?? {})
  };
}

async function createTempFile(name: string, contents: string | Buffer): Promise<{ root: string; filePath: string }> {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-onedrive-remote-test-"));
  const filePath = path.join(root, name);
  await fsPromises.writeFile(filePath, contents);
  return { root, filePath };
}

describe("uploadOneDriveRemoteFile", () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    mockedDelay.mockClear();
    mockedResolveWorkspaceSourceAccess.mockReset();
    mockedGetSourceCatalogEntry.mockReset();
    mockedSourceConnectionCanWrite.mockReset();
    mockedSourceConnectionCanWrite.mockReturnValue(true);
    mockedResolveWorkspaceSourceAccess.mockResolvedValue({
      accessToken: "token-1",
      connection: {
        provider: "onedrive",
        tokens: {
          accessToken: "token-1",
          refreshToken: null,
          expiresAt: null,
          scope: "Files.ReadWrite",
          tokenType: "Bearer",
          raw: {
            scope: "Files.ReadWrite"
          }
        }
      }
    });
    mockedGetSourceCatalogEntry.mockReturnValue({
      provider: "onedrive"
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(tempRoots.splice(0).map((root) => fsPromises.rm(root, { recursive: true, force: true })));
  });

  it("falls back to an upload session when a small direct upload gets a transient server error", async () => {
    const temp = await createTempFile("report.docx", "hello from meowbert");
    tempRoots.push(temp.root);
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ error: { message: "Internal server error" } }, 500))
      .mockResolvedValueOnce(createJsonResponse({ uploadUrl: "https://upload.example/session" }, 200))
      .mockResolvedValueOnce(createJsonResponse(createRemoteFilePayload(), 200));

    const result = await uploadOneDriveRemoteFile({
      workspaceId: "ws-1",
      sourceId: "onedrive",
      itemId: "item-1",
      localFilePath: temp.filePath,
      ifMatchEtag: "\"etag-1\""
    });

    expect(result.eTag).toBe("etag-2");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/me/drive/items/item-1/content");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/me/drive/items/item-1/createUploadSession");
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe("https://upload.example/session");

    const directHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const sessionHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(directHeaders["if-match"]).toBe("\"etag-1\"");
    expect(sessionHeaders["if-match"]).toBe("\"etag-1\"");
  });

  it("retries transient upload-session chunk failures before surfacing an error", async () => {
    const largeContents = Buffer.alloc((4 * 1024 * 1024) + 1024, 7);
    const temp = await createTempFile("large-report.docx", largeContents);
    tempRoots.push(temp.root);
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ uploadUrl: "https://upload.example/retry-session" }, 200))
      .mockResolvedValueOnce(createJsonResponse({ error: { message: "Internal server error" } }, 500))
      .mockResolvedValueOnce(createJsonResponse(createRemoteFilePayload({ size: largeContents.length }), 200));

    const result = await uploadOneDriveRemoteFile({
      workspaceId: "ws-1",
      sourceId: "onedrive",
      itemId: "item-1",
      localFilePath: temp.filePath,
      ifMatchEtag: null
    });

    expect(result.sizeBytes).toBe(largeContents.length);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mockedDelay).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://upload.example/retry-session");
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe("https://upload.example/retry-session");
  });

  it("surfaces remote lock errors with a client-visible status and message", async () => {
    const temp = await createTempFile("locked-report.docx", "locked");
    tempRoots.push(temp.root);
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ error: { message: "The resource you are attempting to access is locked" } }, 423)
    );

    const error = await uploadOneDriveRemoteFile({
      workspaceId: "ws-1",
      sourceId: "onedrive",
      itemId: "item-1",
      localFilePath: temp.filePath,
      ifMatchEtag: "\"etag-1\""
    }).catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(SourceFileLinkRemoteLockedError);
    expect(error).toMatchObject({
      statusCode: 423,
      exposeMessage: true,
      message: expect.stringContaining("locked")
    });
  });
});
