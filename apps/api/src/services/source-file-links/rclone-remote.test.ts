import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRcloneStoredTokens, normalizeRcloneConfig } from "../sources/rclone-config.js";

const {
  mockedGetSourceCatalogEntry,
  mockedResolveWorkspaceSourceAccess,
  mockedRcloneLsjson
} = vi.hoisted(() => ({
  mockedGetSourceCatalogEntry: vi.fn(),
  mockedResolveWorkspaceSourceAccess: vi.fn(),
  mockedRcloneLsjson: vi.fn()
}));

vi.mock("../sources/source-catalog.js", () => ({
  getSourceCatalogEntry: mockedGetSourceCatalogEntry
}));

vi.mock("../sources/source-access.js", () => ({
  resolveWorkspaceSourceAccess: mockedResolveWorkspaceSourceAccess
}));

vi.mock("../sources/rclone-cli.js", () => ({
  RcloneCommandError: class RcloneCommandError extends Error {
    stderr = "";
    exitCode = 1;
  },
  createRcloneCatResponse: vi.fn(),
  rcloneCopyTo: vi.fn(),
  rcloneDeleteFile: vi.fn(),
  rcloneLsjson: mockedRcloneLsjson,
  rcloneMkdir: vi.fn(),
  rclonePurge: vi.fn()
}));

import { listRcloneRemoteFolderChildren } from "./rclone-remote.js";

function createTokens() {
  return buildRcloneStoredTokens(normalizeRcloneConfig({
    rcloneConfig: "[docs]\ntype = alias\nremote = /srv/docs\n",
    remoteName: "docs",
    baseDirectory: "team"
  }));
}

describe("rclone live sync remote", () => {
  beforeEach(() => {
    mockedGetSourceCatalogEntry.mockReset();
    mockedResolveWorkspaceSourceAccess.mockReset();
    mockedRcloneLsjson.mockReset();
    mockedGetSourceCatalogEntry.mockReturnValue({ provider: "rclone" });
    mockedResolveWorkspaceSourceAccess.mockResolvedValue({
      connection: {
        tokens: createTokens()
      }
    });
  });

  it("rebases listed child paths under the requested folder item id", async () => {
    mockedRcloneLsjson.mockResolvedValueOnce([
      {
        Name: "Nested",
        Path: "Nested",
        IsDir: true
      },
      {
        Name: "notes.txt",
        Path: "notes.txt",
        IsDir: false,
        MimeType: "text/plain",
        Size: 8
      }
    ]);

    const children = await listRcloneRemoteFolderChildren({
      workspaceId: "ws-1",
      sourceId: "rclone",
      folderItemId: "Documents/Test"
    });

    expect(mockedRcloneLsjson).toHaveBeenCalledWith(expect.objectContaining({
      remotePath: "docs:team/Documents/Test",
      hash: true
    }));
    expect(children).toEqual([
      expect.objectContaining({
        itemId: "Documents/Test/Nested",
        kind: "folder",
        name: "Nested"
      }),
      expect.objectContaining({
        itemId: "Documents/Test/notes.txt",
        kind: "file",
        name: "notes.txt",
        sizeBytes: 8
      })
    ]);
  });
});
