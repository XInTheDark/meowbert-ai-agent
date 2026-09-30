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
  fetchGoogleDriveRemoteSnapshot,
  uploadGoogleDriveRemoteFile
} from "./google-drive-remote.js";
import { SourceFileLinkProviderError } from "./provider-errors.js";

function createJsonResponse(payload: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      ...(headers ?? {})
    }
  });
}

function createGoogleFilePayload(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "google-file-1",
    name: "Planning Doc",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-05-01T00:00:00.000Z",
    webViewLink: "https://docs.google.com/document/d/google-file-1/edit",
    version: "12",
    ...(overrides ?? {})
  };
}

async function createTempFile(name: string, contents: string | Buffer): Promise<{ root: string; filePath: string }> {
  const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-google-drive-remote-test-"));
  const filePath = path.join(root, name);
  await fsPromises.writeFile(filePath, contents);
  return { root, filePath };
}

describe("google-drive live sync remote", () => {
  const tempRoots: string[] = [];

  beforeEach(() => {
    mockedDelay.mockClear();
    mockedResolveWorkspaceSourceAccess.mockReset();
    mockedGetSourceCatalogEntry.mockReset();
    mockedSourceConnectionCanWrite.mockReset();
    mockedSourceConnectionCanWrite.mockReturnValue(true);
    mockedResolveWorkspaceSourceAccess.mockResolvedValue({
      accessToken: "google-token-1",
      connection: {
        provider: "google-drive",
        tokens: {
          accessToken: "google-token-1",
          refreshToken: null,
          expiresAt: null,
          scope: "https://www.googleapis.com/auth/drive",
          tokenType: "Bearer",
          raw: {
            scope: "https://www.googleapis.com/auth/drive"
          }
        }
      }
    });
    mockedGetSourceCatalogEntry.mockReturnValue({
      provider: "google-drive"
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(tempRoots.splice(0).map((root) => fsPromises.rm(root, { recursive: true, force: true })));
  });

  it("maps Google Drive metadata into the shared remote snapshot shape", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(createGoogleFilePayload({ size: "4096", md5Checksum: "md5-1" }), 200, {
        etag: "\"etag-1\""
      })
    );

    const snapshot = await fetchGoogleDriveRemoteSnapshot({
      workspaceId: "ws-1",
      sourceId: "google-drive",
      itemId: "google-file-1"
    });

    expect(snapshot).toMatchObject({
      itemId: "google-file-1",
      name: "Planning Doc",
      mimeType: "application/vnd.google-apps.document",
      webUrl: "https://docs.google.com/document/d/google-file-1/edit",
      sizeBytes: 4096,
      eTag: "\"etag-1\"",
      cTag: "md5-1"
    });
  });

  it("preserves URL resource keys in live sync snapshots", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(createGoogleFilePayload({ size: "4096" }), 200, {
        etag: "\"etag-1\""
      })
    );

    const snapshot = await fetchGoogleDriveRemoteSnapshot({
      workspaceId: "ws-1",
      sourceId: "google-drive",
      itemId: "google-file-1::resourceKey::resource-1"
    });

    expect(snapshot.itemId).toBe("google-file-1::resourceKey::resource-1");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/drive/v3/files/google-file-1");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-goog-drive-resource-keys": "google-file-1/resource-1"
    });
  });

  it("surfaces missing write access as a client-visible reconnect action", async () => {
    mockedSourceConnectionCanWrite.mockReturnValue(false);

    const error = await fetchGoogleDriveRemoteSnapshot({
      workspaceId: "ws-1",
      sourceId: "google-drive",
      itemId: "google-file-1",
      requireWriteAccess: true
    }).catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(SourceFileLinkProviderError);
    expect(error).toMatchObject({
      statusCode: 409,
      exposeMessage: true,
      message: "Reconnect the workspace Google Drive source to grant write access before using live sync."
    });
  });

  it("pushes exported Google Docs files back as native Google document updates", async () => {
    const temp = await createTempFile("Planning Doc.docx", "updated docx bytes");
    tempRoots.push(temp.root);
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse(createGoogleFilePayload(), 200, {
          etag: "\"etag-1\""
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse(createGoogleFilePayload({ version: "13" }), 200, {
          etag: "\"etag-2\""
        })
      );

    const snapshot = await uploadGoogleDriveRemoteFile({
      workspaceId: "ws-1",
      sourceId: "google-drive",
      itemId: "google-file-1",
      localFilePath: temp.filePath,
      ifMatchEtag: "\"etag-1\""
    });

    expect(snapshot.eTag).toBe("\"etag-2\"");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/upload/drive/v3/files/google-file-1");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("uploadType=multipart");

    const uploadOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const headers = uploadOptions.headers as Record<string, string>;
    expect(headers["if-match"]).toBe("\"etag-1\"");
    expect(headers["content-type"]).toContain("multipart/related");
    expect(Buffer.isBuffer(uploadOptions.body)).toBe(true);
    const body = (uploadOptions.body as Buffer).toString("utf8");
    expect(body).toContain("\"mimeType\":\"application/vnd.google-apps.document\"");
    expect(body).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });
});
