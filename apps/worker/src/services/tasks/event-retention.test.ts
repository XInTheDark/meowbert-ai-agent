import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import {
  TASK_EVENT_RETENTION_BACKLOG_INTERVAL_MS,
  TASK_EVENT_RETENTION_SAFETY_INTERVAL_MS
} from "@meowbert/shared";
import {
  EMAIL_DEBUG_EVENT_RETENTION_DAYS,
  TASK_EVENT_RETENTION_LIMIT,
  runTaskEventRetentionCleanupOnce,
  runEmailDebugEventRetentionCleanupOnce,
  startEventRetentionCleanupLoop
} from "./event-retention.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("runTaskEventRetentionCleanupOnce", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("deletes events beyond the newest per-task limit when debug mode is disabled", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ debug_mode: false }] } as never)
      .mockResolvedValueOnce({ rowCount: 7, rows: [] } as never);

    const deletedCount = await runTaskEventRetentionCleanupOnce();

    expect(deletedCount).toBe(7);
    expect(mockedQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("ORDER BY te.created_at DESC, te.id DESC"),
      [20, 100, 5000]
    );
    expect(mockedQuery.mock.calls[1][0]).toContain("DELETE FROM task_events");
    expect(mockedQuery.mock.calls[1][0]).toContain("WHERE NOT COALESCE");
    expect(TASK_EVENT_RETENTION_LIMIT).toBe(20);
  });

  it("retains every task event when debug mode is enabled", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ debug_mode: true }] } as never);

    const deletedCount = await runTaskEventRetentionCleanupOnce();

    expect(deletedCount).toBe(0);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedQuery.mock.calls[0][0]).toContain("FROM platform_settings");
  });

  it("fails without issuing a deletion when debug mode cannot be loaded", async () => {
    mockedQuery.mockRejectedValueOnce(new Error("settings unavailable"));

    await expect(runTaskEventRetentionCleanupOnce()).rejects.toThrow("settings unavailable");

    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it("returns 0 when no rows are deleted", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ debug_mode: false }] } as never)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);

    const deletedCount = await runTaskEventRetentionCleanupOnce();

    expect(deletedCount).toBe(0);
  });
});

describe("runEmailDebugEventRetentionCleanupOnce", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("deletes email debug events older than the retention window", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 4, rows: [] } as never);

    const deletedCount = await runEmailDebugEventRetentionCleanupOnce(Date.parse("2026-04-28T08:00:00.000Z"));

    expect(deletedCount).toBe(4);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM email_inbound_debug_events"),
      ["2026-04-14T08:00:00.000Z", 5000]
    );
    expect(EMAIL_DEBUG_EVENT_RETENTION_DAYS).toBe(14);
  });

  it("returns 0 when no rows are deleted", async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);

    const deletedCount = await runEmailDebugEventRetentionCleanupOnce(Date.parse("2026-04-28T08:00:00.000Z"));

    expect(deletedCount).toBe(0);
  });
});

describe("startEventRetentionCleanupLoop", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    mockedQuery.mockReset();
    vi.useFakeTimers();
  });

  it("drains a discovered backlog every minute, then checks only once daily", async () => {
    const taskDeleteCounts = [5000, 0, 0];
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("DELETE FROM task_events")) {
        return { rowCount: taskDeleteCounts.shift() ?? 0, rows: [] } as never;
      }
      if (sql.includes("DELETE FROM email_inbound_debug_events")) {
        return { rowCount: 0, rows: [] } as never;
      }
      if (sql.includes("FROM platform_settings")) {
        return { rowCount: 1, rows: [{ debug_mode: false }] } as never;
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const loop = startEventRetentionCleanupLoop();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedQuery.mock.calls.filter(([sql]) => sql.includes("DELETE FROM task_events"))).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(TASK_EVENT_RETENTION_BACKLOG_INTERVAL_MS);
    expect(mockedQuery.mock.calls.filter(([sql]) => sql.includes("DELETE FROM task_events"))).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(TASK_EVENT_RETENTION_BACKLOG_INTERVAL_MS);
    expect(mockedQuery.mock.calls.filter(([sql]) => sql.includes("DELETE FROM task_events"))).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(TASK_EVENT_RETENTION_SAFETY_INTERVAL_MS);
    expect(mockedQuery.mock.calls.filter(([sql]) => sql.includes("DELETE FROM task_events"))).toHaveLength(3);
    await loop.stop();
  });
});
