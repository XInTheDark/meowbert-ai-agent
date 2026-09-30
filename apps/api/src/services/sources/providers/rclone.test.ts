import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockedCreateRcloneCatResponse,
  mockedRcloneLsjson,
  mockedUpsertWorkspaceSourceConnection
} = vi.hoisted(() => ({
  mockedCreateRcloneCatResponse: vi.fn(),
  mockedRcloneLsjson: vi.fn(),
  mockedUpsertWorkspaceSourceConnection: vi.fn()
}));

vi.mock("../rclone-cli.js", () => ({
  createRcloneCatResponse: mockedCreateRcloneCatResponse,
  rcloneLsjson: mockedRcloneLsjson
}));

vi.mock("../workspace-source-connections.js", () => ({
  upsertWorkspaceSourceConnection: mockedUpsertWorkspaceSourceConnection
}));

import {
  connectWorkspaceRcloneSource,
  rcloneProviderClient
} from "./rclone.js";
import {
  buildRcloneRemotePath,
  buildRcloneStoredTokens,
  normalizeRcloneConfig
} from "../rclone-config.js";

function createTokens() {
  return buildRcloneStoredTokens(normalizeRcloneConfig({
    rcloneConfig: "[docs]\ntype = alias\nremote = /srv/docs\n",
    remoteName: "docs",
    baseDirectory: "team"
  }));
}

describe("rcloneProviderClient", () => {
  beforeEach(() => {
    mockedCreateRcloneCatResponse.mockReset();
    mockedRcloneLsjson.mockReset();
    mockedUpsertWorkspaceSourceConnection.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("browses the configured remote base directory", async () => {
    mockedRcloneLsjson.mockResolvedValueOnce([
      {
        Name: "Plans",
        Path: "Plans",
        IsDir: true,
        ModTime: "2026-06-01T00:00:00Z"
      },
      {
        Name: "notes.txt",
        Path: "notes.txt",
        IsDir: false,
        MimeType: "text/plain",
        Size: 12,
        ModTime: "2026-06-02T00:00:00Z"
      }
    ]);

    const result = await rcloneProviderClient.browse({
      accessToken: "unused",
      tokens: createTokens(),
      folderId: null,
      limit: 25
    });

    expect(mockedRcloneLsjson).toHaveBeenCalledWith({
      sourceConfig: {
        rcloneConfig: "[docs]\ntype = alias\nremote = /srv/docs",
        remoteName: "docs",
        baseDirectory: "team"
      },
      remotePath: "docs:team"
    });
    expect(result.folder).toEqual({
      id: null,
      name: "team",
      parentId: null
    });
    expect(result.items).toEqual([
      {
        id: "Plans",
        name: "Plans",
        displayPath: "Plans",
        kind: "folder",
        mimeType: null,
        sizeBytes: null,
        modifiedAt: "2026-06-01T00:00:00.000Z",
        parentId: null
      },
      {
        id: "notes.txt",
        name: "notes.txt",
        displayPath: "notes.txt",
        kind: "file",
        mimeType: "text/plain",
        sizeBytes: 12,
        modifiedAt: "2026-06-02T00:00:00.000Z",
        parentId: null
      }
    ]);
  });

  it("searches recursively by path and name", async () => {
    mockedRcloneLsjson.mockResolvedValueOnce([
      {
        Name: "Q1.pdf",
        Path: "Plans/Q1.pdf",
        IsDir: false,
        MimeType: "application/pdf",
        Size: 42
      }
    ]);

    const result = await rcloneProviderClient.search({
      accessToken: "unused",
      tokens: createTokens(),
      query: "plans",
      folderId: null,
      limit: 10
    });

    expect(mockedRcloneLsjson).toHaveBeenCalledTimes(1);
    expect(mockedRcloneLsjson).toHaveBeenCalledWith(expect.objectContaining({
      remotePath: "docs:team",
      recursive: true
    }));
    expect(result.items.map((item) => item.id)).toEqual(["Plans/Q1.pdf"]);
  });

  it("matches rclone paths through explicit path lookup", async () => {
    mockedRcloneLsjson
      .mockResolvedValueOnce({
        Name: "",
        Path: "",
        IsDir: true
      })
      .mockResolvedValueOnce([]);

    const result = await rcloneProviderClient.resolvePath({
      accessToken: "unused",
      tokens: createTokens(),
      path: "Backup Files/Nested",
      folderId: null,
    });

    expect(mockedRcloneLsjson).toHaveBeenCalledWith(expect.objectContaining({
      remotePath: "docs:team/Backup Files/Nested",
      stat: true
    }));
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "Backup Files/Nested",
        name: "Nested",
        kind: "folder",
        parentId: "Backup Files"
      })
    ]);
  });

  it("keeps parent folder paths when browsing nested folders", async () => {
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
        Size: 8
      }
    ]);

    const result = await rcloneProviderClient.browse({
      accessToken: "unused",
      tokens: createTokens(),
      folderId: "Backup Files",
      limit: 25
    });

    expect(mockedRcloneLsjson).toHaveBeenCalledWith(expect.objectContaining({
      remotePath: "docs:team/Backup Files"
    }));
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "Backup Files/Nested",
        name: "Nested",
        parentId: "Backup Files"
      }),
      expect.objectContaining({
        id: "Backup Files/notes.txt",
        name: "notes.txt",
        parentId: "Backup Files"
      })
    ]);
  });

  it("stores workspace rclone config after validating the remote", async () => {
    mockedRcloneLsjson.mockResolvedValueOnce([]);
    mockedUpsertWorkspaceSourceConnection.mockResolvedValueOnce({});

    const result = await connectWorkspaceRcloneSource({
      workspaceId: "workspace-1",
      userId: "user-1",
      rcloneConfig: "[archive]\ntype = alias\nremote = /srv/archive\n",
      remoteName: "archive",
      baseDirectory: "reports"
    });

    expect(result).toEqual({ accountLabel: "archive:reports" });
    expect(mockedUpsertWorkspaceSourceConnection).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      provider: "rclone",
      accountId: "archive",
      accountLabel: "archive:reports",
      updatedByUserId: "user-1"
    }));
    const tokens = mockedUpsertWorkspaceSourceConnection.mock.calls[0]?.[0]?.tokens;
    expect(tokens.raw).toMatchObject({
      remoteName: "archive",
      baseDirectory: "reports"
    });
    expect(tokens.raw.rcloneConfig).toContain("[archive]");
  });

  it("rejects configs that do not contain the requested remote section", () => {
    expect(() => normalizeRcloneConfig({
      rcloneConfig: "[other]\ntype = alias\nremote = /srv/other\n",
      remoteName: "archive",
      baseDirectory: null
    })).toThrow("rclone.conf does not contain a [archive] section.");
  });

  it("builds the rclone root path without adding a dot segment", () => {
    const config = normalizeRcloneConfig({
      rcloneConfig: "[docs]\ntype = alias\nremote = /srv/docs\n",
      remoteName: "docs",
      baseDirectory: null
    });

    expect(buildRcloneRemotePath(config, null)).toBe("docs:");
    expect(buildRcloneRemotePath(config, "Plans/Q1.pdf")).toBe("docs:Plans/Q1.pdf");
  });

  it("builds rclone paths inside the configured base directory", () => {
    const config = normalizeRcloneConfig({
      rcloneConfig: "[docs]\ntype = alias\nremote = /srv/docs\n",
      remoteName: "docs",
      baseDirectory: "team"
    });

    expect(buildRcloneRemotePath(config, null)).toBe("docs:team");
    expect(buildRcloneRemotePath(config, "Plans/Q1.pdf")).toBe("docs:team/Plans/Q1.pdf");
  });
});
