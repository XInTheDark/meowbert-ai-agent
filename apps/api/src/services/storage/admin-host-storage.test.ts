import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@meowbert/shared", () => ({
  TASK_EVENT_INSERT_PRUNE_LIMIT: 100,
  TASK_EVENT_RETENTION_BACKLOG_INTERVAL_MS: 60000,
  TASK_EVENT_RETENTION_DELETE_LIMIT: 5000,
  TASK_EVENT_RETENTION_LIMIT: 20,
  TASK_EVENT_RETENTION_SAFETY_INTERVAL_MS: 86400000,
  pruneTaskEvents: vi.fn()
}));

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withConnection: vi.fn()
}));

vi.mock("../tasks/task-history.js", () => ({
  getConfiguredTaskHistoryArchiveHealth: vi.fn()
}));

import { pruneTaskEvents } from "@meowbert/shared";
import { query, withConnection } from "../../lib/db.js";
import { getConfiguredTaskHistoryArchiveHealth } from "../tasks/task-history.js";
import {
  listAdminHostStorageOverview,
  pruneAdminTaskEvents,
  queueAdminTaskHistoryArchive,
  vacuumFullAdminTaskEvents
} from "./admin-host-storage.js";

function rows<Row extends object>(items: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows: items,
    rowCount: items.length
  };
}

describe("admin host storage service", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithConnection = vi.mocked(withConnection);
  const mockedHealth = vi.mocked(getConfiguredTaskHistoryArchiveHealth);
  const mockedPruneTaskEvents = vi.mocked(pruneTaskEvents);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedHealth.mockResolvedValue({
      enabled: true,
      mountPath: "/archive",
      rootPath: "/archive/tasks",
      mounted: true,
      state: "ready",
      message: null
    });
  });

  it("reports PostgreSQL sizes, event policy, archive state, and recent runs", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM platform_settings")) {
        return rows([{ debug_mode: false, task_history_warm_retention_days: 14 }]);
      }
      if (sql.includes("pg_database_size")) {
        return rows([{ database_name: "meowbert", database_bytes: "26843545600" }]);
      }
      if (sql.includes("FROM pg_stat_user_tables")) {
        return rows([{
          relation_name: "task_events",
          table_bytes: "23000000000",
          index_bytes: "1000000",
          total_bytes: "23001000000",
          estimated_live_rows: "42000",
          estimated_dead_rows: "9000",
          last_vacuum_at: null,
          last_autovacuum_at: "2026-08-23T00:00:00.000Z"
        }]);
      }
      if (sql.includes("eligible_count")) {
        return rows([{
          warm_count: "8",
          archiving_count: "1",
          archived_count: "12",
          failed_count: "2",
          eligible_count: "3"
        }]);
      }
      if (sql.includes("FROM task_history_archive_runs")) {
        return rows([{
          id: "run-1",
          task_id: "task-1",
          task_title: "Archived task",
          trigger_source: "scheduled",
          status: "completed",
          archive_key: "v1/task-1.json.gz",
          original_size_bytes: "1000",
          compressed_size_bytes: "250",
          message_count: 4,
          event_count: 20,
          revision_count: 1,
          workflow_message_count: 2,
          error_summary: null,
          created_at: "2026-08-23T00:00:00.000Z",
          started_at: "2026-08-23T00:00:01.000Z",
          completed_at: "2026-08-23T00:00:02.000Z"
        }]);
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const overview = await listAdminHostStorageOverview();

    expect(overview.postgres).toMatchObject({
      databaseName: "meowbert",
      databaseBytes: 26843545600,
      relations: [{ name: "task_events", totalBytes: 23001000000 }]
    });
    expect(overview.eventRetention).toEqual({
      debugMode: false,
      pruningEnabled: true,
      retainedEventsPerTask: 20,
      insertPruneBatchSize: 100,
      backlogIntervalSeconds: 60,
      backlogDeleteBatchSize: 5000,
      safetyIntervalHours: 24
    });
    expect(overview.taskHistoryArchive).toMatchObject({
      healthState: "ready",
      warmRetentionDays: 14,
      eligibleTaskCount: 3,
      recentRuns: [{ id: "run-1", originalSizeBytes: 1000, compressedSizeBytes: 250 }]
    });
  });

  it("uses the shared debug-safe event pruning policy", async () => {
    mockedPruneTaskEvents.mockResolvedValue({ debugMode: false, deletedCount: 17 });

    await expect(pruneAdminTaskEvents()).resolves.toEqual({
      debugMode: false,
      deletedCount: 17
    });
    expect(mockedPruneTaskEvents).toHaveBeenCalledWith(query);
  });

  it("physically rewrites task_events and reports reclaimed bytes", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(rows([{ locked: true }]))
        .mockResolvedValueOnce(rows([{ total_bytes: "23000000000" }]))
        .mockResolvedValueOnce(rows([]))
        .mockResolvedValueOnce(rows([{ total_bytes: "100000000" }]))
        .mockResolvedValueOnce(rows([{ pg_advisory_unlock: true }]))
    };
    mockedWithConnection.mockImplementation(async (fn) => fn(client as never));

    const result = await vacuumFullAdminTaskEvents();

    expect(result).toMatchObject({
      beforeBytes: 23000000000,
      afterBytes: 100000000,
      reclaimedBytes: 22900000000
    });
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      "VACUUM (FULL, ANALYZE) public.task_events"
    );
  });

  it("queues a manual archive request even when the previous run left no eligible task", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM platform_settings")) {
        return rows([{ debug_mode: false, task_history_warm_retention_days: 7 }]);
      }
      if (sql.includes("status = 'queued'")) {
        return rows([]);
      }
      if (sql.includes("INSERT INTO task_history_archive_runs")) {
        return rows([{
          id: "run-new",
          task_id: null,
          task_title: null,
          trigger_source: "manual",
          status: "queued",
          archive_key: null,
          original_size_bytes: null,
          compressed_size_bytes: null,
          message_count: null,
          event_count: null,
          revision_count: null,
          workflow_message_count: null,
          error_summary: null,
          created_at: "2026-08-23T00:00:00.000Z",
          started_at: null,
          completed_at: null
        }]);
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const run = await queueAdminTaskHistoryArchive({ requestedByUserId: "user-1" });

    expect(run).toMatchObject({ id: "run-new", triggerSource: "manual", status: "queued" });
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("run.status = 'queued'"),
    );
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO task_history_archive_runs"),
      ["user-1"]
    );
  });
});
