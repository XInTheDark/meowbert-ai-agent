import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@meowbert/shared", () => ({
  getTaskHistoryArchiveHealth: vi.fn()
}));

vi.mock("../../lib/config.js", () => ({
  config: {
    taskHistoryArchive: {
      enabled: true,
      mountPath: "/archive",
      archivesDir: "tasks",
      rootPath: "/archive/tasks"
    }
  }
}));

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withConnection: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("./task-history.js", () => ({
  archiveTaskHistory: vi.fn(),
  resetStaleTaskHistoryArchiving: vi.fn()
}));

vi.mock("./task-history-archive-activity.js", () => ({
  attachTaskToArchiveRun: vi.fn(),
  completeArchiveRun: vi.fn(),
  createScheduledArchiveRun: vi.fn(),
  failArchiveRun: vi.fn(),
  skipArchiveRun: vi.fn()
}));

import { getTaskHistoryArchiveHealth } from "@meowbert/shared";
import { query, withConnection, withTransaction } from "../../lib/db.js";
import { archiveTaskHistory, resetStaleTaskHistoryArchiving } from "./task-history.js";
import {
  completeArchiveRun,
  createScheduledArchiveRun
} from "./task-history-archive-activity.js";
import {
  runTaskHistoryArchivePass,
  startTaskHistoryArchiveLoop
} from "./task-history-archive-loop.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("runTaskHistoryArchivePass", () => {
  const mockedGetHealth = vi.mocked(getTaskHistoryArchiveHealth);
  const mockedQuery = vi.mocked(query);
  const mockedWithConnection = vi.mocked(withConnection);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedArchiveTaskHistory = vi.mocked(archiveTaskHistory);
  const mockedResetStale = vi.mocked(resetStaleTaskHistoryArchiving);
  const mockedCompleteArchiveRun = vi.mocked(completeArchiveRun);
  const mockedCreateScheduledArchiveRun = vi.mocked(createScheduledArchiveRun);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetHealth.mockResolvedValue({
      enabled: true,
      mounted: true,
      mountPath: "/archive",
      rootPath: "/archive/tasks",
      state: "ready",
      message: null
    });
    mockedResetStale.mockResolvedValue(0);
    mockedCreateScheduledArchiveRun.mockResolvedValue("archive-run-1");
    mockedWithConnection.mockImplementation(async (callback) => callback({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 })
    } as never));
  });

  it("archives at most one task per pass so backlog cannot monopolize Postgres", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ task_history_warm_retention_days: 1 }],
      rowCount: 1
    } as never);

    const client = { query: vi.fn() };
    client.query.mockResolvedValueOnce({
      rows: [{ id: "task-1" }],
      rowCount: 1
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    mockedArchiveTaskHistory.mockResolvedValue({ status: "archived", archiveKey: "archive-1" });

    const archivedCount = await runTaskHistoryArchivePass();

    expect(archivedCount).toBe(1);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0]?.[0]).toContain("t.task_history_archive_failed_attempts < $2");
    expect(client.query.mock.calls[0]?.[0]).toContain("ORDER BY GREATEST(");
    expect(client.query.mock.calls[0]?.[1]).toEqual([expect.any(String), 3]);
    expect(mockedArchiveTaskHistory).toHaveBeenCalledTimes(1);
    expect(mockedArchiveTaskHistory).toHaveBeenCalledWith("task-1");
    expect(mockedCompleteArchiveRun).toHaveBeenCalledWith(
      "archive-run-1",
      { status: "archived", archiveKey: "archive-1" }
    );
    expect(mockedWithConnection).toHaveBeenCalledTimes(1);
  });

  it("starts immediately and continues an archive backlog after a short yield", async () => {
    vi.useFakeTimers();
    mockedQuery.mockResolvedValue({
      rows: [{ task_history_warm_retention_days: 1 }],
      rowCount: 1
    } as never);
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "task-1" }], rowCount: 1 })
    };
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
    mockedArchiveTaskHistory.mockResolvedValue({ status: "archived", archiveKey: "archive-1" });

    const loop = startTaskHistoryArchiveLoop();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedArchiveTaskHistory).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(mockedArchiveTaskHistory).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockedArchiveTaskHistory).toHaveBeenCalledTimes(2);
    await loop.stop();
  });
});
