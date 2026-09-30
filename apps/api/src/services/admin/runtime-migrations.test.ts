import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../storage/backend-registry.js", () => ({
  storageBackendRegistry: {
    resolveManagedEnvironmentRoot: vi.fn(),
    resolveManagedWorkspaceRoot: vi.fn(),
    getBackend: vi.fn(),
    listBackends: vi.fn()
  }
}));

vi.mock("../storage/local-xfs-project-quotas.js", () => ({
  inspectConfiguredLocalXfsProjectQuotaBackend: vi.fn(),
  listConfiguredLocalXfsProjectQuotaBackends: vi.fn()
}));

import { query, withTransaction } from "../../lib/db.js";
import { storageBackendRegistry } from "../storage/backend-registry.js";
import {
  inspectConfiguredLocalXfsProjectQuotaBackend,
  listConfiguredLocalXfsProjectQuotaBackends
} from "../storage/local-xfs-project-quotas.js";
import { listAdminRuntimeMigrations, queueAdminRuntimeMigration } from "./runtime-migrations.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("admin runtime migrations service", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedStorageBackendRegistry = vi.mocked(storageBackendRegistry);
  const mockedInspectLocalXfsBackend = vi.mocked(inspectConfiguredLocalXfsProjectQuotaBackend);
  const mockedListLocalXfsBackends = vi.mocked(listConfiguredLocalXfsProjectQuotaBackends);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports pending environment nesting work and blocks xfs provisioning until that migration is done", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM admin_runtime_migrations")) {
        return buildRowsResult([]);
      }
      if (sql.includes("FROM environments e")) {
        return buildRowsResult([
          {
            id: "env-1",
            workspace_id: "ws-1",
            root_path: "/runtime/environments/ws-1/env-1/root",
            storage_backend_id: "local-default"
          }
        ]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    mockedStorageBackendRegistry.resolveManagedEnvironmentRoot.mockReturnValue("/runtime/workspaces/ws-1/environments/env-1/root");
    mockedListLocalXfsBackends.mockReturnValue([
      {
        id: "local-default",
        type: "local",
        workspacesRoot: "/runtime/workspaces",
        environmentsRoot: "/runtime/environments",
        xfsProjectQuota: {
          mountPath: "/runtime/workspaces",
          projectIdBase: 10_000
        }
      }
    ]);

    const migrations = await listAdminRuntimeMigrations();

    expect(migrations[0]).toMatchObject({
      key: "nest_environment_roots",
      status: "ready",
      pendingItems: 1
    });
    expect(migrations[1]).toMatchObject({
      key: "provision_local_xfs_project_quotas",
      status: "action_required"
    });
    expect(migrations[1]?.blockedReason).toContain("Run the environment nesting migration first");
  });

  it("reports xfs quota provisioning as ready when host checks pass and local workspaces still need project ids", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM admin_runtime_migrations")) {
        return buildRowsResult([]);
      }
      if (sql.includes("FROM environments e")) {
        return buildRowsResult([]);
      }
      if (sql.includes("FROM workspaces") && sql.includes("storage_project_id")) {
        return buildRowsResult([
          {
            id: "ws-1",
            root_path: "/runtime/workspaces/ws-1/root",
            storage_backend_id: "local-default",
            storage_project_id: null
          }
        ]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    mockedListLocalXfsBackends.mockReturnValue([
      {
        id: "local-default",
        type: "local",
        workspacesRoot: "/runtime/workspaces",
        environmentsRoot: "/runtime/environments",
        xfsProjectQuota: {
          mountPath: "/runtime/workspaces",
          projectIdBase: 10_000
        }
      }
    ]);
    mockedStorageBackendRegistry.resolveManagedWorkspaceRoot.mockReturnValue("/runtime/workspaces-xfs/ws-1/root");
    mockedInspectLocalXfsBackend.mockResolvedValue({
      ready: true,
      message: "Project quota state on /runtime/workspaces"
    });

    const migrations = await listAdminRuntimeMigrations();

    expect(migrations[1]).toMatchObject({
      key: "provision_local_xfs_project_quotas",
      status: "ready",
      pendingItems: 1
    });
  });

  it("queues a runtime migration when it is ready", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM admin_runtime_migrations")) {
        return buildRowsResult([]);
      }
      if (sql.includes("FROM environments e")) {
        return buildRowsResult([]);
      }
      if (sql.includes("FROM workspaces") && sql.includes("storage_project_id")) {
        return buildRowsResult([
          {
            id: "ws-1",
            root_path: "/runtime/workspaces/ws-1/root",
            storage_backend_id: "local-default",
            storage_project_id: null
          }
        ]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    mockedListLocalXfsBackends.mockReturnValue([
      {
        id: "local-default",
        type: "local",
        workspacesRoot: "/runtime/workspaces",
        environmentsRoot: "/runtime/environments",
        xfsProjectQuota: {
          mountPath: "/runtime/workspaces",
          projectIdBase: 10_000
        }
      }
    ]);
    mockedInspectLocalXfsBackend.mockResolvedValue({
      ready: true,
      message: "ready"
    });
    mockedStorageBackendRegistry.resolveManagedWorkspaceRoot.mockReturnValue("/runtime/workspaces-xfs/ws-1/root");

    mockedWithTransaction.mockImplementation(async (callback) => callback({
      query: vi.fn(async (sql: string) => {
        if (sql.includes("WHERE migration_key = $1")) {
          return buildRowsResult([]);
        }
        if (sql.includes("INSERT INTO admin_runtime_migrations")) {
          return buildRowsResult([
            {
              id: "migration-1",
              migration_key: "provision_local_xfs_project_quotas",
              status: "queued",
              error_summary: null,
              summary_json: {},
              created_at: "2026-03-21T00:00:00.000Z",
              updated_at: "2026-03-21T00:00:00.000Z",
              started_at: null,
              completed_at: null
            }
          ]);
        }

        throw new Error(`Unexpected tx query: ${sql}`);
      })
    } as never));

    const queued = await queueAdminRuntimeMigration({
      migrationKey: "provision_local_xfs_project_quotas",
      requestedByUserId: "user-1"
    });

    expect(queued).toMatchObject({
      id: "migration-1",
      status: "queued"
    });
  });
});
