import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import {
  parseStoredSourceTokens,
  sourceConnectionCanWrite
} from "./workspace-source-connections.js";
import type { WorkspaceSourceConnection } from "./source-types.js";

function createConnection(overrides: Partial<WorkspaceSourceConnection>): WorkspaceSourceConnection {
  return {
    workspaceId: "ws-1",
    provider: "google-drive",
    tokens: {
      accessToken: "token-1",
      refreshToken: null,
      expiresAt: null,
      scope: null,
      tokenType: "Bearer",
      raw: {}
    },
    accountId: null,
    accountLabel: null,
    connectedAt: "2026-05-01T00:00:00.000Z",
    updatedByUserId: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides
  };
}

describe("sourceConnectionCanWrite", () => {
  it("treats Google Drive full access as writable", () => {
    expect(sourceConnectionCanWrite(createConnection({
      tokens: {
        accessToken: "token-1",
        refreshToken: null,
        expiresAt: null,
        scope: "https://www.googleapis.com/auth/drive",
        tokenType: "Bearer",
        raw: {}
      }
    }))).toBe(true);
  });

  it("does not treat Google Drive readonly access as writable", () => {
    expect(sourceConnectionCanWrite(createConnection({
      tokens: {
        accessToken: "token-1",
        refreshToken: null,
        expiresAt: null,
        scope: "https://www.googleapis.com/auth/drive.readonly",
        tokenType: "Bearer",
        raw: {}
      }
    }))).toBe(false);
  });

  it("treats rclone workspace configs as writable", () => {
    expect(sourceConnectionCanWrite(createConnection({
      provider: "rclone",
      tokens: {
        accessToken: "rclone-config",
        refreshToken: null,
        expiresAt: null,
        scope: "rclone",
        tokenType: null,
        raw: {
          rcloneConfig: "[docs]\ntype = alias\nremote = /srv/docs",
          remoteName: "docs",
          baseDirectory: ""
        }
      }
    }))).toBe(true);
  });
});

describe("parseStoredSourceTokens", () => {
  it("preserves nested provider token payloads", () => {
    const tokens = parseStoredSourceTokens({
      accessToken: "rclone-config",
      refreshToken: null,
      expiresAt: null,
      scope: "rclone",
      tokenType: null,
      raw: {
        rcloneConfig: "[pcloud]\ntype = pcloud\n",
        remoteName: "pcloud",
        baseDirectory: ""
      }
    });

    expect(tokens.raw).toEqual({
      rcloneConfig: "[pcloud]\ntype = pcloud\n",
      remoteName: "pcloud",
      baseDirectory: ""
    });
  });

  it("keeps legacy flat token payloads readable", () => {
    const tokens = parseStoredSourceTokens({
      accessToken: "token-1",
      hostname: "eapi.pcloud.com"
    });

    expect(tokens.raw).toMatchObject({
      accessToken: "token-1",
      hostname: "eapi.pcloud.com"
    });
  });
});
