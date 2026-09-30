import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../agent-db/user-resource-limits.js", () => ({
  resolveWorkspaceStorageLimitBytes: vi.fn()
}));

vi.mock("../runtime/environment-storage.js", () => ({
  resolveTaskEnvironmentRoot: vi.fn()
}));

vi.mock("./workspace-storage.js", () => ({
  resolveTaskWorkspaceRoot: vi.fn()
}));

import { query } from "../../lib/db.js";
import { resolveWorkspaceStorageLimitBytes } from "../agent-db/user-resource-limits.js";
import { resolveTaskEnvironmentRoot } from "../runtime/environment-storage.js";
import { resolveTaskWorkspaceRoot } from "./workspace-storage.js";
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

describe("worker workspace storage usage service", () => {
  const mockedQuery = vi.mocked(query);
  const mockedResolveTaskEnvironmentRoot = vi.mocked(resolveTaskEnvironmentRoot);
  const mockedResolveTaskWorkspaceRoot = vi.mocked(resolveTaskWorkspaceRoot);
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
    const roots = createStorageRoots("meowbert-worker-storage-");
    tempDirs.push(roots.baseDir);
    mockedResolveTaskWorkspaceRoot.mockResolvedValue(roots.workspaceRoot);
    mockedResolveTaskEnvironmentRoot.mockResolvedValue(roots.environmentRoot);
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
    const roots = createStorageRoots("meowbert-worker-storage-");
    tempDirs.push(roots.baseDir);
    mockedResolveTaskWorkspaceRoot.mockResolvedValue(roots.workspaceRoot);
    mockedResolveTaskEnvironmentRoot.mockResolvedValue(roots.environmentRoot);
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
      actorUserId: "admin-1",
      actorIsSuperAdmin: true
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
