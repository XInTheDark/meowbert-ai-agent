import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../../lib/queue.js", () => ({
  taskQueue: {
    getJob: vi.fn()
  }
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn().mockResolvedValue(undefined)
}));

import { query, withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { emitTaskEvent } from "../runtime/events.js";
import { runTaskTimeLimitSweepOnce } from "./task-time-limit.js";

describe("runTaskTimeLimitSweepOnce", () => {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedGetJob = vi.mocked(taskQueue.getJob);
  const mockedEmitTaskEvent = vi.mocked(emitTaskEvent);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels expired task scopes, removes pending jobs, and emits cancellation events", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ root_task_id: "task-root" }],
      rowCount: 1
    } as never);

    const client = {
      query: vi.fn()
    };
    client.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "task-root",
            status: "queued",
            time_limit_deadline_at: "2026-03-19T00:00:00.000Z"
          },
          {
            id: "task-worker",
            status: "running",
            time_limit_deadline_at: "2026-03-19T00:00:00.000Z"
          }
        ],
        rowCount: 2
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ run_id: "run-queued", task_id: "task-root" }],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    const remove = vi.fn().mockResolvedValue(undefined);
    mockedGetJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("delayed"),
      remove
    } as never);

    const cancelledScopeCount = await runTaskTimeLimitSweepOnce();

    expect(cancelledScopeCount).toBe(1);
    expect(mockedGetJob).toHaveBeenCalledWith(expect.stringContaining("task-root"));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(mockedEmitTaskEvent).toHaveBeenCalledWith("task-root", "status", { status: "cancelled" });
    expect(mockedEmitTaskEvent).toHaveBeenCalledWith("task-root", "log", {
      message: "Task cancelled because its time limit expired."
    });
    expect(mockedEmitTaskEvent).toHaveBeenCalledWith("task-worker", "log", {
      message: "Task cancelled because its time limit expired."
    });
  });
});
