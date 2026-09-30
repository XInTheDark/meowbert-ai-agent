import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../runtime/environment-storage.js", () => ({
  resolveManagedTaskEnvironmentRoot: vi.fn(),
  resolveTaskEnvironmentRoot: vi.fn()
}));

vi.mock("../workspaces/workspace-storage.js", () => ({
  resolveManagedTaskWorkspaceRoot: vi.fn(),
  resolveTaskWorkspaceRoot: vi.fn()
}));

import { query, withTransaction } from "../../lib/db.js";
import {
  resolveManagedTaskEnvironmentRoot,
  resolveTaskEnvironmentRoot
} from "../runtime/environment-storage.js";
import {
  resolveManagedTaskWorkspaceRoot,
  resolveTaskWorkspaceRoot
} from "../workspaces/workspace-storage.js";
import {
  recoverStaleWorkspaceStorageMigrationsOnce,
  runWorkspaceStorageMigrationLoopOnce
} from "./workspace-storage-migrations.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("workspace storage migrations", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedResolveTaskWorkspaceRoot = vi.mocked(resolveTaskWorkspaceRoot);
  const mockedResolveManagedTaskWorkspaceRoot = vi.mocked(resolveManagedTaskWorkspaceRoot);
  const mockedResolveTaskEnvironmentRoot = vi.mocked(resolveTaskEnvironmentRoot);
  const mockedResolveManagedTaskEnvironmentRoot = vi.mocked(resolveManagedTaskEnvironmentRoot);
  const tempDirs: string[] = [];
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    consoleErrorSpy.mockRestore();
    await Promise.all(tempDirs.splice(0).map((dir) => fsPromises.rm(dir, { recursive: true, force: true })));
  });

  it("copies workspace/environment contents and updates rows when the target roots are empty", async () => {
    const sourceBase = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-storage-migration-src-"));
    const targetBase = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-storage-migration-dst-"));
    tempDirs.push(sourceBase, targetBase);

    const sourceWorkspaceRoot = path.join(sourceBase, "workspace-root");
    const sourceEnvironmentRoot = path.join(sourceBase, "environment-root");
    const targetWorkspaceRoot = path.join(targetBase, "workspace-root");
    const targetEnvironmentRoot = path.join(targetBase, "environment-root");

    await fsPromises.mkdir(path.join(sourceWorkspaceRoot, "docs"), { recursive: true });
    await fsPromises.mkdir(path.join(sourceEnvironmentRoot, "data"), { recursive: true });
    await fsPromises.writeFile(path.join(sourceWorkspaceRoot, "docs", "readme.md"), "# migrated");
    await fsPromises.writeFile(path.join(sourceEnvironmentRoot, "data", "artifact.txt"), "artifact");

    mockedResolveTaskWorkspaceRoot.mockResolvedValue(sourceWorkspaceRoot);
    mockedResolveManagedTaskWorkspaceRoot.mockResolvedValue(targetWorkspaceRoot);
    mockedResolveTaskEnvironmentRoot.mockResolvedValue(sourceEnvironmentRoot);
    mockedResolveManagedTaskEnvironmentRoot.mockResolvedValue(targetEnvironmentRoot);

    const claimClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("WHERE status = 'queued'")) {
          return buildRowsResult([{ id: "migration-1" }]);
        }
        if (sql.includes("SET status = 'running'")) {
          return buildRowsResult([
            {
              id: "migration-1",
              workspace_id: "ws-1",
              requested_by_user_id: "user-1",
              source_backend_id: "local-default",
              target_backend_id: "nfs-main",
              request_source: "manual"
            }
          ]);
        }

        throw new Error(`Unexpected claim query: ${sql}`);
      })
    };

    const finalizeClient = {
      query: vi.fn(async () => buildRowsResult([]))
    };

    let transactionIndex = 0;
    mockedWithTransaction.mockImplementation(async (callback) => {
      transactionIndex += 1;
      return callback((transactionIndex === 1 ? claimClient : finalizeClient) as never);
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SET heartbeat_at = now()")) {
        return buildRowsResult([]);
      }
      if (sql.includes("FROM workspaces")) {
        return buildRowsResult([
          {
            id: "ws-1",
            root_path: sourceWorkspaceRoot,
            storage_backend_id: "local-default"
          }
        ]);
      }
      if (sql.includes("FROM environments")) {
        return buildRowsResult([
          {
            id: "env-1",
            workspace_id: "ws-1",
            root_path: sourceEnvironmentRoot
          }
        ]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(runWorkspaceStorageMigrationLoopOnce("worker-1")).resolves.toBe(true);
    await expect(fsPromises.readFile(path.join(targetWorkspaceRoot, "docs", "readme.md"), "utf8")).resolves.toBe("# migrated");
    await expect(fsPromises.readFile(path.join(targetEnvironmentRoot, "data", "artifact.txt"), "utf8")).resolves.toBe("artifact");
    expect(finalizeClient.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("UPDATE workspaces"),
      ["ws-1", "nfs-main", targetWorkspaceRoot]
    );
    expect(finalizeClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE environments"),
      ["env-1", targetEnvironmentRoot]
    );
    expect(finalizeClient.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("UPDATE workspace_storage_migrations"),
      ["migration-1"]
    );
  });

  it("continues the migration even when the workspace still has active tasks", async () => {
    const sourceBase = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-storage-migration-src-"));
    const targetBase = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-storage-migration-dst-"));
    tempDirs.push(sourceBase, targetBase);

    const sourceWorkspaceRoot = path.join(sourceBase, "workspace-root");
    const targetWorkspaceRoot = path.join(targetBase, "workspace-root");

    await fsPromises.mkdir(path.join(sourceWorkspaceRoot, "docs"), { recursive: true });
    await fsPromises.writeFile(path.join(sourceWorkspaceRoot, "docs", "readme.md"), "# migrated");

    mockedResolveTaskWorkspaceRoot.mockResolvedValue(sourceWorkspaceRoot);
    mockedResolveManagedTaskWorkspaceRoot.mockResolvedValue(targetWorkspaceRoot);

    const claimClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("WHERE status = 'queued'")) {
          return buildRowsResult([{ id: "migration-1" }]);
        }
        if (sql.includes("SET status = 'running'")) {
          return buildRowsResult([
            {
              id: "migration-1",
              workspace_id: "ws-1",
              requested_by_user_id: "user-1",
              source_backend_id: "local-default",
              target_backend_id: "nfs-main",
              request_source: "manual"
            }
          ]);
        }

        throw new Error(`Unexpected claim query: ${sql}`);
      })
    };

    const finalizeClient = {
      query: vi.fn(async () => buildRowsResult([]))
    };

    let transactionIndex = 0;
    mockedWithTransaction.mockImplementation(async (callback) => {
      transactionIndex += 1;
      return callback((transactionIndex === 1 ? claimClient : finalizeClient) as never);
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SET heartbeat_at = now()")) {
        return buildRowsResult([]);
      }
      if (sql.includes("FROM workspaces")) {
        return buildRowsResult([
          {
            id: "ws-1",
            root_path: sourceWorkspaceRoot,
            storage_backend_id: "local-default"
          }
        ]);
      }
      if (sql.includes("FROM environments")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(runWorkspaceStorageMigrationLoopOnce("worker-1")).resolves.toBe(true);
    await expect(fsPromises.readFile(path.join(targetWorkspaceRoot, "docs", "readme.md"), "utf8")).resolves.toBe("# migrated");
    expect(finalizeClient.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("UPDATE workspaces"),
      ["ws-1", "nfs-main", targetWorkspaceRoot]
    );
    expect(finalizeClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE workspace_storage_migrations"),
      ["migration-1"]
    );
  });

  it("clears non-empty target roots and continues the migration", async () => {
    const sourceBase = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-storage-migration-src-"));
    const targetBase = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-storage-migration-dst-"));
    tempDirs.push(sourceBase, targetBase);

    const sourceWorkspaceRoot = path.join(sourceBase, "workspace-root");
    const sourceEnvironmentRoot = path.join(sourceBase, "environment-root");
    const targetWorkspaceRoot = path.join(targetBase, "workspace-root");
    const targetEnvironmentRoot = path.join(targetBase, "environment-root");

    await fsPromises.mkdir(path.join(sourceWorkspaceRoot, "docs"), { recursive: true });
    await fsPromises.mkdir(path.join(sourceEnvironmentRoot, "data"), { recursive: true });
    await fsPromises.writeFile(path.join(sourceWorkspaceRoot, "docs", "readme.md"), "# migrated");
    await fsPromises.writeFile(path.join(sourceEnvironmentRoot, "data", "artifact.txt"), "artifact");

    await fsPromises.mkdir(path.join(targetWorkspaceRoot, "stale"), { recursive: true });
    await fsPromises.mkdir(path.join(targetEnvironmentRoot, "stale"), { recursive: true });
    await fsPromises.writeFile(path.join(targetWorkspaceRoot, "stale", "leftover.txt"), "stale");
    await fsPromises.writeFile(path.join(targetEnvironmentRoot, "stale", "leftover.txt"), "stale");

    mockedResolveTaskWorkspaceRoot.mockResolvedValue(sourceWorkspaceRoot);
    mockedResolveManagedTaskWorkspaceRoot.mockResolvedValue(targetWorkspaceRoot);
    mockedResolveTaskEnvironmentRoot.mockResolvedValue(sourceEnvironmentRoot);
    mockedResolveManagedTaskEnvironmentRoot.mockResolvedValue(targetEnvironmentRoot);

    const claimClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("WHERE status = 'queued'")) {
          return buildRowsResult([{ id: "migration-1" }]);
        }
        if (sql.includes("SET status = 'running'")) {
          return buildRowsResult([
            {
              id: "migration-1",
              workspace_id: "ws-1",
              requested_by_user_id: "user-1",
              source_backend_id: "local-default",
              target_backend_id: "nfs-main",
              request_source: "manual"
            }
          ]);
        }

        throw new Error(`Unexpected claim query: ${sql}`);
      })
    };

    const finalizeClient = {
      query: vi.fn(async () => buildRowsResult([]))
    };

    let transactionIndex = 0;
    mockedWithTransaction.mockImplementation(async (callback) => {
      transactionIndex += 1;
      return callback((transactionIndex === 1 ? claimClient : finalizeClient) as never);
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SET heartbeat_at = now()")) {
        return buildRowsResult([]);
      }
      if (sql.includes("FROM workspaces")) {
        return buildRowsResult([
          {
            id: "ws-1",
            root_path: sourceWorkspaceRoot,
            storage_backend_id: "local-default"
          }
        ]);
      }
      if (sql.includes("FROM environments")) {
        return buildRowsResult([
          {
            id: "env-1",
            workspace_id: "ws-1",
            root_path: sourceEnvironmentRoot
          }
        ]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(runWorkspaceStorageMigrationLoopOnce("worker-1")).resolves.toBe(true);
    await expect(fsPromises.readFile(path.join(targetWorkspaceRoot, "docs", "readme.md"), "utf8")).resolves.toBe("# migrated");
    await expect(fsPromises.readFile(path.join(targetEnvironmentRoot, "data", "artifact.txt"), "utf8")).resolves.toBe("artifact");
    await expect(fsPromises.access(path.join(targetWorkspaceRoot, "stale", "leftover.txt"))).rejects.toThrow();
    await expect(fsPromises.access(path.join(targetEnvironmentRoot, "stale", "leftover.txt"))).rejects.toThrow();
  });

  it("recovers stale running migrations by clearing partial target data and re-queueing them", async () => {
    const sourceBase = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-storage-recovery-src-"));
    const targetBase = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-storage-recovery-dst-"));
    tempDirs.push(sourceBase, targetBase);

    const sourceWorkspaceRoot = path.join(sourceBase, "workspace-root");
    const sourceEnvironmentRoot = path.join(sourceBase, "environment-root");
    const targetWorkspaceRoot = path.join(targetBase, "workspace-root");
    const targetEnvironmentRoot = path.join(targetBase, "environment-root");

    await fsPromises.mkdir(path.join(sourceWorkspaceRoot, "docs"), { recursive: true });
    await fsPromises.mkdir(path.join(sourceEnvironmentRoot, "data"), { recursive: true });
    await fsPromises.mkdir(path.join(targetWorkspaceRoot, "partial"), { recursive: true });
    await fsPromises.mkdir(path.join(targetEnvironmentRoot, "partial"), { recursive: true });
    await fsPromises.writeFile(path.join(targetWorkspaceRoot, "partial", "leftover.txt"), "stale");
    await fsPromises.writeFile(path.join(targetEnvironmentRoot, "partial", "leftover.txt"), "stale");

    mockedResolveManagedTaskWorkspaceRoot.mockResolvedValue(targetWorkspaceRoot);
    mockedResolveManagedTaskEnvironmentRoot.mockResolvedValue(targetEnvironmentRoot);
    mockedResolveTaskWorkspaceRoot.mockResolvedValue(sourceWorkspaceRoot);
    mockedResolveTaskEnvironmentRoot.mockResolvedValue(sourceEnvironmentRoot);

    const recoveryClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("WHERE status = 'running'")) {
          return buildRowsResult([{ id: "migration-1" }]);
        }
        if (sql.includes("SET updated_at = now()")) {
          return buildRowsResult([
            {
              id: "migration-1",
              workspace_id: "ws-1",
              requested_by_user_id: "user-1",
              source_backend_id: "local-default",
              target_backend_id: "nfs-main",
              request_source: "manual"
            }
          ]);
        }

        throw new Error(`Unexpected recovery query: ${sql}`);
      })
    };

    let recoveryClaimed = false;
    mockedWithTransaction.mockImplementation(async (callback) => {
      if (recoveryClaimed) {
        return callback({
          query: vi.fn(async () => buildRowsResult([]))
        } as never);
      }
      recoveryClaimed = true;
      return callback(recoveryClient as never);
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM workspaces")) {
        return buildRowsResult([
          {
            id: "ws-1",
            root_path: sourceWorkspaceRoot,
            storage_backend_id: "local-default"
          }
        ]);
      }
      if (sql.includes("FROM environments")) {
        return buildRowsResult([
          {
            id: "env-1",
            workspace_id: "ws-1",
            root_path: sourceEnvironmentRoot
          }
        ]);
      }
      if (sql.includes("SET status = 'queued'")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SET heartbeat_at = now()")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(recoverStaleWorkspaceStorageMigrationsOnce("worker-1")).resolves.toBe(1);
    await expect(fsPromises.readdir(targetWorkspaceRoot)).resolves.toEqual([]);
    await expect(fsPromises.readdir(targetEnvironmentRoot)).resolves.toEqual([]);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'queued'"),
      ["migration-1"]
    );
  });
});
