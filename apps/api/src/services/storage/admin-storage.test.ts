import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("./backend-registry.js", () => ({
  storageBackendRegistry: {
    listBackends: vi.fn(),
    getBackendHealth: vi.fn(),
    getBackend: vi.fn(),
    getConfiguredDefaultBackendId: vi.fn()
  }
}));

vi.mock("./default-backend.js", () => ({
  getDefaultWorkspaceStorageBackendId: vi.fn(),
  updateDefaultWorkspaceStorageBackendId: vi.fn()
}));

vi.mock("../tasks/task-history.js", () => ({
  getConfiguredTaskHistoryArchiveHealth: vi.fn()
}));

import { query, withTransaction } from "../../lib/db.js";
import { storageBackendRegistry } from "./backend-registry.js";
import { getDefaultWorkspaceStorageBackendId } from "./default-backend.js";
import { getConfiguredTaskHistoryArchiveHealth } from "../tasks/task-history.js";
import {
  listAdminStorageOverview,
  queueWorkspaceStorageMigration,
  searchAdminStorageUsers,
  testAdminStorageBackend
} from "./admin-storage.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("admin storage service", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedGetDefaultWorkspaceStorageBackendId = vi.mocked(getDefaultWorkspaceStorageBackendId);
  const mockedListBackends = vi.mocked(storageBackendRegistry.listBackends);
  const mockedGetBackend = vi.mocked(storageBackendRegistry.getBackend);
  const mockedGetBackendHealth = vi.mocked(storageBackendRegistry.getBackendHealth);
  const mockedGetConfiguredDefaultBackendId = vi.mocked(storageBackendRegistry.getConfiguredDefaultBackendId);
  const mockedGetConfiguredTaskHistoryArchiveHealth = vi.mocked(getConfiguredTaskHistoryArchiveHealth);
  let configuredBackends: ReturnType<typeof storageBackendRegistry.listBackends>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockedGetConfiguredDefaultBackendId.mockReturnValue("local-default");
    configuredBackends = [
      {
        id: "local-default",
        label: "Local (legacy)",
        type: "local",
        workspacesRoot: "/runtime/workspaces",
        environmentsRoot: "/runtime/environments"
      },
      {
        id: "mounted-main",
        label: "Mounted main",
        type: "mounted",
        mountPath: "/runtime/storage/mounted-main"
      }
    ];
    mockedListBackends.mockReturnValue(configuredBackends);
    mockedGetBackend.mockImplementation((backendId) => {
      const backend = configuredBackends.find((entry) => entry.id === backendId);
      if (!backend) {
        throw new Error(`missing backend ${backendId}`);
      }
      return backend;
    });
    mockedGetBackendHealth.mockImplementation(async (backendId) => ({
      backendId,
      mounted: true,
      state: "ready",
      message: null
    }));
    mockedGetConfiguredTaskHistoryArchiveHealth.mockResolvedValue({
      enabled: true,
      mountPath: "/runtime/storage/task-history-archive",
      rootPath: "/runtime/storage/task-history-archive/tasks",
      mounted: true,
      state: "ready",
      message: null
    });
  });

  it("lists admin storage overview with backend health and latest migration info", async () => {
    mockedGetDefaultWorkspaceStorageBackendId.mockResolvedValue("mounted-main");
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY storage_backend_id")) {
        return buildRowsResult([
          { storage_backend_id: "local-default", count: 1 },
          { storage_backend_id: "mounted-main", count: 2 }
        ]);
      }
      if (sql.includes("FILTER (WHERE status = 'queued')")) {
        return buildRowsResult([
          { queued_count: 1, running_count: 1 }
        ]);
      }
      if (sql.includes("task_history_warm_retention_days")) {
        return buildRowsResult([
          { task_history_warm_retention_days: 30, task_count: 7 }
        ]);
      }
      if (sql.includes("WHERE m.status IN ('queued', 'running')")) {
        return buildRowsResult([
          {
            id: "migration-1",
            workspace_id: "ws-1",
            workspace_name: "Workspace One",
            owner_email: "owner@example.com",
            source_backend_id: "local-default",
            target_backend_id: "mounted-main",
            status: "running",
            request_source: "manual",
            created_at: "2026-03-20T00:00:00.000Z",
            updated_at: "2026-03-20T00:10:00.000Z",
            started_at: "2026-03-20T00:00:30.000Z"
          }
        ]);
      }
      if (sql.includes("owner_filter.user_id = $1")) {
        return buildRowsResult([
          {
            id: "ws-1",
            name: "Workspace One",
            root_path: "/runtime/workspaces/ws-1/root",
            storage_backend_id: "local-default",
            owner_email: "owner@example.com",
            latest_migration_id: "migration-1",
            latest_migration_source_backend_id: "local-default",
            latest_migration_target_backend_id: "mounted-main",
            latest_migration_status: "running",
            latest_migration_error_summary: null,
            latest_migration_request_source: "manual",
            latest_migration_created_at: "2026-03-20T00:00:00.000Z",
            latest_migration_updated_at: "2026-03-20T00:10:00.000Z",
            latest_migration_started_at: "2026-03-20T00:00:30.000Z",
            latest_migration_completed_at: null
          }
        ]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const overview = await listAdminStorageOverview({ ownerUserId: "owner-1" });
    const archiveSummarySql = mockedQuery.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes("task_history_warm_retention_days"));

    expect(overview).toEqual({
      defaultWorkspaceBackendId: "mounted-main",
      configuredDefaultWorkspaceBackendId: "local-default",
      backends: [
        {
          id: "local-default",
          type: "local",
          label: "Local (legacy)",
          workspaceCount: 1,
          mounted: true,
          healthState: "ready",
          healthMessage: null
        },
        {
          id: "mounted-main",
          type: "mounted",
          label: "Mounted main",
          workspaceCount: 2,
          mounted: true,
          healthState: "ready",
          healthMessage: null
        }
      ],
      migrationActivity: {
        queuedCount: 1,
        runningCount: 1,
        hiddenActiveCount: 1,
        activeMigrations: [
          {
            id: "migration-1",
            workspaceId: "ws-1",
            workspaceName: "Workspace One",
            ownerEmail: "owner@example.com",
            sourceBackendId: "local-default",
            sourceBackendLabel: "Local (legacy)",
            targetBackendId: "mounted-main",
            targetBackendLabel: "Mounted main",
            status: "running",
            requestSource: "manual",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:10:00.000Z",
            startedAt: "2026-03-20T00:00:30.000Z"
          }
        ]
      },
      taskHistoryArchive: {
        enabled: true,
        mountPath: "/runtime/storage/task-history-archive",
        rootPath: "/runtime/storage/task-history-archive/tasks",
        mounted: true,
        healthState: "ready",
        healthMessage: null,
        warmRetentionDays: 30,
        taskCount: 7
      },
      workspaces: [
        {
          id: "ws-1",
          name: "Workspace One",
          ownerEmail: "owner@example.com",
          storageBackendId: "local-default",
          storageBackendLabel: "Local (legacy)",
          rootPath: "/runtime/workspaces/ws-1/root",
          latestMigration: {
            id: "migration-1",
            sourceBackendId: "local-default",
            targetBackendId: "mounted-main",
            status: "running",
            errorSummary: null,
            requestSource: "manual",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:10:00.000Z",
            startedAt: "2026-03-20T00:00:30.000Z",
            completedAt: null
          }
        }
      ]
    });
    expect(archiveSummarySql).toBeDefined();
    expect(archiveSummarySql ?? "").toContain("FROM tasks");
    expect(archiveSummarySql ?? "").not.toContain("task_history_state = 'archived'");
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("owner_filter.user_id = $1"), ["owner-1"]);
  });

  it("omits workspace rows until an owner is selected", async () => {
    mockedGetDefaultWorkspaceStorageBackendId.mockResolvedValue("mounted-main");
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("GROUP BY storage_backend_id")) {
        return buildRowsResult([
          { storage_backend_id: "local-default", count: 1 },
          { storage_backend_id: "mounted-main", count: 2 }
        ]);
      }
      if (sql.includes("FILTER (WHERE status = 'queued')")) {
        return buildRowsResult([
          { queued_count: 0, running_count: 0 }
        ]);
      }
      if (sql.includes("task_history_warm_retention_days")) {
        return buildRowsResult([
          { task_history_warm_retention_days: 0, task_count: 0 }
        ]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const overview = await listAdminStorageOverview();

    expect(overview.workspaces).toEqual([]);
    expect(overview.migrationActivity).toEqual({
      queuedCount: 0,
      runningCount: 0,
      hiddenActiveCount: 0,
      activeMigrations: []
    });
    expect(overview.taskHistoryArchive).toEqual({
      enabled: true,
      mountPath: "/runtime/storage/task-history-archive",
      rootPath: "/runtime/storage/task-history-archive/tasks",
      mounted: true,
      healthState: "ready",
      healthMessage: null,
      warmRetentionDays: 0,
      taskCount: 0
    });
    expect(mockedQuery).toHaveBeenCalledTimes(3);
  });

  it("reads mounted backend health passively when loading the overview", async () => {
    configuredBackends = [
      ...configuredBackends,
      {
        id: "mounted-backup",
        label: "Mounted backup",
        type: "mounted",
        mountPath: "/runtime/storage/mounted-backup"
      }
    ];
    mockedListBackends.mockReturnValue(configuredBackends);
    mockedGetBackend.mockImplementation((backendId) => {
      const backend = configuredBackends.find((entry) => entry.id === backendId);
      if (!backend) {
        throw new Error(`missing backend ${backendId}`);
      }
      return backend;
    });
    mockedGetDefaultWorkspaceStorageBackendId.mockResolvedValue("local-default");
    mockedQuery
      .mockResolvedValueOnce(buildRowsResult([
        { storage_backend_id: "local-default", count: 1 }
      ]))
      .mockResolvedValueOnce(buildRowsResult([
        { queued_count: 0, running_count: 0 }
      ]))
      .mockResolvedValueOnce(buildRowsResult([
        { task_history_warm_retention_days: 14, task_count: 3 }
      ]));

    await listAdminStorageOverview();

    expect(mockedGetBackendHealth).toHaveBeenCalledWith("local-default", { ensureMounted: false });
    expect(mockedGetBackendHealth).toHaveBeenCalledWith("mounted-main", { ensureMounted: false });
    expect(mockedGetBackendHealth).toHaveBeenCalledWith("mounted-backup", { ensureMounted: false });
  });

  it("searches storage users by email with owned workspace counts", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([
      {
        id: "user-1",
        email: "owner@example.com",
        display_name: "Owner",
        owned_workspace_count: 3
      }
    ]));

    const users = await searchAdminStorageUsers({
      search: "owner@example.com",
      limit: 5
    });

    expect(users).toEqual([
      {
        id: "user-1",
        email: "owner@example.com",
        displayName: "Owner",
        ownedWorkspaceCount: 3
      }
    ]);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE u.email ILIKE $1"),
      ["%owner@example.com%", "owner@example.com", "owner@example.com%", 5]
    );
  });

  it("tests a backend mount explicitly and returns the refreshed health summary", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([{ count: 2 }]));
    mockedGetBackendHealth.mockResolvedValueOnce({
      backendId: "mounted-main",
      mounted: false,
      state: "error",
      message: "Mounted storage backend path is not an active mountpoint inside the API/worker container: /runtime/storage/mounted-main."
    });

    const summary = await testAdminStorageBackend({
      backendId: "mounted-main"
    });

    expect(summary).toEqual({
      id: "mounted-main",
      type: "mounted",
      label: "Mounted main",
      workspaceCount: 2,
      mounted: false,
      healthState: "error",
      healthMessage: "Mounted storage backend path is not an active mountpoint inside the API/worker container: /runtime/storage/mounted-main."
    });
    expect(mockedGetBackendHealth).toHaveBeenCalledWith("mounted-main", { ensureMounted: true });
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE storage_backend_id = $1"),
      ["mounted-main"]
    );
  });

  it("queues a workspace migration through the transaction helper", async () => {
    const client = {
      query: vi.fn()
    };
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    client.query
      .mockResolvedValueOnce(buildRowsResult([
        {
          storage_backend_id: "local-default"
        }
      ]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([
        {
          id: "migration-1",
          status: "queued"
        }
      ]));

    const migration = await queueWorkspaceStorageMigration({
      workspaceId: "ws-1",
      targetBackendId: "mounted-main",
      requestedByUserId: "user-1"
    });

    expect(migration).toEqual({
      id: "migration-1",
      status: "queued"
    });
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO workspace_storage_migrations"),
      ["ws-1", "user-1", "local-default", "mounted-main", "manual"]
    );
  });
});
