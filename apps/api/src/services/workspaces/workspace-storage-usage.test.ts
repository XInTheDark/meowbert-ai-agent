import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../users/resource-limits.js", () => ({
  resolveWorkspaceStorageLimitBytes: vi.fn()
}));

vi.mock("../environments/environment-storage.js", () => ({
  ensureEnvironmentStorageRoot: vi.fn()
}));

vi.mock("./workspace-storage.js", () => ({
  ensureWorkspaceStorageRoot: vi.fn()
}));

import { query } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "../environments/environment-storage.js";
import { resolveWorkspaceStorageLimitBytes } from "../users/resource-limits.js";
import { ensureWorkspaceStorageRoot } from "./workspace-storage.js";
import { getWorkspaceStorageUsage, throwIfWorkspaceStorageLimitExceeded } from "./workspace-storage-usage.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

function createStorageRoots(prefix: string): { baseDir: string; workspaceRoot: string; environmentRoot: string } {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const workspaceRoot = path.join(baseDir, "workspace");
  const environmentRoot = path.join(baseDir, "environment");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(environmentRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "workspace.bin"), Buffer.alloc(256, "w"));
  fs.writeFileSync(path.join(environmentRoot, "environment.bin"), Buffer.alloc(256, "e"));
  return { baseDir, workspaceRoot, environmentRoot };
}

describe("workspace storage usage service", () => {
  const mockedQuery = vi.mocked(query);
  const mockedEnsureEnvironmentStorageRoot = vi.mocked(ensureEnvironmentStorageRoot);
  const mockedEnsureWorkspaceStorageRoot = vi.mocked(ensureWorkspaceStorageRoot);
  const mockedResolveWorkspaceStorageLimitBytes = vi.mocked(resolveWorkspaceStorageLimitBytes);
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockedQuery.mockResolvedValue(buildRowsResult([]));
    mockedResolveWorkspaceStorageLimitBytes.mockResolvedValue(1024 * 1024);
  });

  it("uses the resolved workspace-owner storage limit", async () => {
    const roots = createStorageRoots("meowbert-api-storage-");
    tempDirs.push(roots.baseDir);
    mockedEnsureWorkspaceStorageRoot.mockResolvedValue(roots.workspaceRoot);
    mockedEnsureEnvironmentStorageRoot.mockResolvedValue(roots.environmentRoot);
    mockedQuery.mockResolvedValueOnce(buildRowsResult([
      {
        id: "env-1",
        workspace_id: "ws-1",
        root_path: "/env-one"
      }
    ]));

    const storage = await getWorkspaceStorageUsage({
      workspaceId: "ws-1",
      workspaceRootPath: "/workspace-root",
      actorUserId: "user-1"
    });

    expect(storage).toEqual({
      usedBytes: 512,
      limitBytes: 1024 * 1024,
      availableBytes: 1024 * 1024 - 512,
      usagePercent: (512 / (1024 * 1024)) * 100,
      isOverLimit: false
    });
    expect(mockedResolveWorkspaceStorageLimitBytes).toHaveBeenCalledWith("ws-1");
  });

  it("treats the workspace as unlimited when no owner limit resolves", async () => {
    const roots = createStorageRoots("meowbert-api-storage-");
    tempDirs.push(roots.baseDir);
    mockedEnsureWorkspaceStorageRoot.mockResolvedValue(roots.workspaceRoot);
    mockedEnsureEnvironmentStorageRoot.mockResolvedValue(roots.environmentRoot);
    mockedQuery.mockResolvedValueOnce(buildRowsResult([
      {
        id: "env-1",
        workspace_id: "ws-1",
        root_path: "/env-one"
      }
    ]));
    mockedResolveWorkspaceStorageLimitBytes.mockResolvedValue(null);

    const storage = await getWorkspaceStorageUsage({
      workspaceId: "ws-1",
      workspaceRootPath: "/workspace-root",
      actorUserId: "admin-1"
    });

    expect(storage).toEqual({
      usedBytes: 512,
      limitBytes: null,
      availableBytes: null,
      usagePercent: null,
      isOverLimit: false
    });
    expect(() => throwIfWorkspaceStorageLimitExceeded(storage)).not.toThrow();
  });
});
