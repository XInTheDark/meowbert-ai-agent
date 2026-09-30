import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../storage/backend-registry.js", () => ({
  storageBackendRegistry: {
    ensureBackendReady: vi.fn(),
    resolveManagedEnvironmentRoot: vi.fn(),
    resolveManagedWorkspaceRoot: vi.fn()
  }
}));

vi.mock("../storage/local-xfs-project-quotas.js", () => ({
  ensureWorkspaceLocalXfsProjectQuota: vi.fn(),
  listConfiguredLocalXfsProjectQuotaBackends: vi.fn()
}));

vi.mock("../tasks/task-cancellation.js", () => ({
  ensureNoActiveTasksForWorkspaces: vi.fn()
}));

import { query, withTransaction } from "../../lib/db.js";
import { storageBackendRegistry } from "../storage/backend-registry.js";
import {
  ensureWorkspaceLocalXfsProjectQuota,
  listConfiguredLocalXfsProjectQuotaBackends
} from "../storage/local-xfs-project-quotas.js";
import { ensureNoActiveTasksForWorkspaces } from "../tasks/task-cancellation.js";
import { runAdminRuntimeMigrationLoopOnce } from "./runtime-migrations.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("runAdminRuntimeMigrationLoopOnce", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedStorageBackendRegistry = vi.mocked(storageBackendRegistry);
  const mockedEnsureWorkspaceLocalXfsProjectQuota = vi.mocked(ensureWorkspaceLocalXfsProjectQuota);
  const mockedListConfiguredLocalXfsProjectQuotaBackends = vi.mocked(listConfiguredLocalXfsProjectQuotaBackends);
  const mockedEnsureNoActiveTasksForWorkspaces = vi.mocked(ensureNoActiveTasksForWorkspaces);
  const tempDirs: string[] = [];
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedEnsureNoActiveTasksForWorkspaces.mockResolvedValue({
      cancelledScopeCount: 0,
      runningTaskCount: 0,
      cancelledTaskCount: 0,
      waitTimedOut: false,
      remainingActiveTaskCount: 0
    });
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    consoleErrorSpy.mockRestore();
    await Promise.all(tempDirs.splice(0).map((dir) => fsPromises.rm(dir, { recursive: true, force: true })));
  });

  it("moves legacy environment roots into the managed workspace layout", async () => {
    const sourceBase = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-admin-migration-src-"));
    const targetBase = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-admin-migration-dst-"));
    tempDirs.push(sourceBase, targetBase);

    const sourceRoot = path.join(sourceBase, "env-root");
    const targetRoot = path.join(targetBase, "workspaces", "ws-1", "environments", "env-1", "root");
    await fsPromises.mkdir(path.join(sourceRoot, "nested"), { recursive: true });
    await fsPromises.writeFile(path.join(sourceRoot, "nested", "artifact.txt"), "migrated");

    mockedStorageBackendRegistry.resolveManagedEnvironmentRoot.mockReturnValue(targetRoot);
    mockedStorageBackendRegistry.ensureBackendReady.mockResolvedValue(undefined);

    const claimClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("WHERE status = 'queued'")) {
          return buildRowsResult([{ id: "migration-1" }]);
        }
        if (sql.includes("SET status = 'running'")) {
          return buildRowsResult([
            {
              id: "migration-1",
              migration_key: "nest_environment_roots"
            }
          ]);
        }

        throw new Error(`Unexpected claim query: ${sql}`);
      })
    };

    mockedWithTransaction.mockImplementation(async (callback) => callback(claimClient as never));
    mockedQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM environments e")) {
        return buildRowsResult([
          {
            id: "env-1",
            workspace_id: "ws-1",
            root_path: sourceRoot,
            storage_backend_id: "local-default"
          }
        ]);
      }
      if (sql.includes("UPDATE environments")) {
        expect(params).toEqual(["env-1", targetRoot]);
        return buildRowsResult([]);
      }
      if (sql.includes("UPDATE admin_runtime_migrations")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(runAdminRuntimeMigrationLoopOnce()).resolves.toBe(true);
    await expect(fsPromises.readFile(path.join(targetRoot, "nested", "artifact.txt"), "utf8")).resolves.toBe("migrated");
    await expect(fsPromises.access(sourceRoot)).rejects.toThrow();
    expect(mockedEnsureNoActiveTasksForWorkspaces).toHaveBeenCalledWith({
      workspaceIds: ["ws-1"],
      cancellationMessage: "Task cancelled by admin migration: environment roots are being moved.",
      timeoutBehavior: "continue"
    });
  });

  it("moves local workspace roots onto the managed xfs path and provisions quotas", async () => {
    const sourceBase = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-admin-xfs-src-"));
    const targetBase = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-admin-xfs-dst-"));
    tempDirs.push(sourceBase, targetBase);

    const sourceRoot = path.join(sourceBase, "workspaces", "ws-1", "root");
    const targetRoot = path.join(targetBase, "workspaces-xfs", "ws-1", "root");
    await fsPromises.mkdir(path.join(sourceRoot, "nested"), { recursive: true });
    await fsPromises.writeFile(path.join(sourceRoot, "nested", "artifact.txt"), "workspace");

    mockedListConfiguredLocalXfsProjectQuotaBackends.mockReturnValue([
      {
        id: "local-default",
        type: "local",
        workspacesRoot: "/runtime/workspaces-xfs",
        environmentsRoot: "/runtime/environments",
        xfsProjectQuota: {
          mountPath: "/runtime/workspaces-xfs",
          projectIdBase: 10_000
        }
      }
    ]);
    mockedStorageBackendRegistry.resolveManagedWorkspaceRoot.mockReturnValue(targetRoot);
    mockedStorageBackendRegistry.ensureBackendReady.mockResolvedValue(undefined);
    mockedEnsureWorkspaceLocalXfsProjectQuota.mockResolvedValue(undefined);

    const claimClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("WHERE status = 'queued'")) {
          return buildRowsResult([{ id: "migration-2" }]);
        }
        if (sql.includes("SET status = 'running'")) {
          return buildRowsResult([
            {
              id: "migration-2",
              migration_key: "provision_local_xfs_project_quotas"
            }
          ]);
        }

        throw new Error(`Unexpected claim query: ${sql}`);
      })
    };

    mockedWithTransaction.mockImplementation(async (callback) => callback(claimClient as never));
    mockedQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM workspaces") && sql.includes("storage_backend_id = ANY")) {
        return buildRowsResult([
          {
            id: "ws-1",
            root_path: sourceRoot,
            storage_backend_id: "local-default"
          }
        ]);
      }
      if (sql.includes("UPDATE workspaces")) {
        expect(params).toEqual(["ws-1", targetRoot]);
        return buildRowsResult([]);
      }
      if (sql.includes("UPDATE admin_runtime_migrations")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    await expect(runAdminRuntimeMigrationLoopOnce()).resolves.toBe(true);
    await expect(fsPromises.readFile(path.join(targetRoot, "nested", "artifact.txt"), "utf8")).resolves.toBe("workspace");
    await expect(fsPromises.access(sourceRoot)).rejects.toThrow();
    expect(mockedEnsureWorkspaceLocalXfsProjectQuota).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      storageBackendId: "local-default",
      workspaceRoot: targetRoot
    });
    expect(mockedEnsureNoActiveTasksForWorkspaces).toHaveBeenCalledWith({
      workspaceIds: ["ws-1"],
      cancellationMessage: "Task cancelled by admin migration: workspace storage is being moved onto XFS."
    });
  });
});
