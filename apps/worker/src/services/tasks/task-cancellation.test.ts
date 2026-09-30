import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("./task-run-dispatch.js", () => ({
  markTaskRunDispatchesCancelled: vi.fn().mockResolvedValue(undefined)
}));

import { query, withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { emitTaskEvent } from "../runtime/events.js";
import { markTaskRunDispatchesCancelled } from "./task-run-dispatch.js";
import { ensureNoActiveTasksForWorkspaces } from "./task-cancellation.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

function mockTimedOutCancellationScenario(): void {
  const mockedQuery = vi.mocked(query);
  const mockedWithTransaction = vi.mocked(withTransaction);

  let activeTaskCountCall = 0;
  mockedQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("COUNT(*)::int AS count")) {
      activeTaskCountCall += 1;
      return buildRowsResult([{
        count: activeTaskCountCall === 1 ? 2 : 1
      }]);
    }
    if (sql.includes("SELECT DISTINCT COALESCE(workflow_parent_task_id, id) AS root_task_id")) {
      return buildRowsResult([{ root_task_id: "task-root" }]);
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  const client = {
    query: vi.fn()
  };
  client.query
    .mockResolvedValueOnce(buildRowsResult([
      { id: "task-root", status: "queued" },
      { id: "task-child", status: "running" }
    ]))
    .mockResolvedValueOnce(buildRowsResult([]))
    .mockResolvedValueOnce(buildRowsResult([]))
    .mockResolvedValueOnce(buildRowsResult([
      { run_id: "run-queued", task_id: "task-root" }
    ]))
    .mockResolvedValueOnce(buildRowsResult([]));

  mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));
}

describe("ensureNoActiveTasksForWorkspaces", () => {
  const mockedGetJob = vi.mocked(taskQueue.getJob);
  const mockedEmitTaskEvent = vi.mocked(emitTaskEvent);
  const mockedMarkTaskRunDispatchesCancelled = vi.mocked(markTaskRunDispatchesCancelled);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockedGetJob.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("continues after the wait timeout when requested", async () => {
    mockTimedOutCancellationScenario();

    const resultPromise = ensureNoActiveTasksForWorkspaces({
      workspaceIds: [" ws-1 ", "ws-1"],
      cancellationMessage: "Task cancelled by admin migration.",
      timeoutMs: 1,
      timeoutBehavior: "continue"
    });

    await vi.advanceTimersByTimeAsync(500);

    await expect(resultPromise).resolves.toEqual({
      cancelledScopeCount: 1,
      runningTaskCount: 1,
      cancelledTaskCount: 1,
      waitTimedOut: true,
      remainingActiveTaskCount: 1
    });
    expect(mockedMarkTaskRunDispatchesCancelled).toHaveBeenCalledWith(["run-queued"]);
    expect(mockedEmitTaskEvent).toHaveBeenCalledWith("task-root", "status", { status: "cancelled" });
    expect(mockedEmitTaskEvent).toHaveBeenCalledWith("task-root", "log", {
      message: "Task cancelled by admin migration."
    });
    expect(mockedEmitTaskEvent).toHaveBeenCalledWith("task-child", "log", {
      message: "Task cancelled by admin migration."
    });
  });

  it("still throws on timeout by default", async () => {
    mockTimedOutCancellationScenario();

    const resultPromise = ensureNoActiveTasksForWorkspaces({
      workspaceIds: ["ws-1"],
      cancellationMessage: "Task cancelled by admin migration.",
      timeoutMs: 1
    });
    const expectation = expect(resultPromise).rejects.toThrow("Timed out waiting for cancelled tasks to stop.");

    await vi.advanceTimersByTimeAsync(500);

    await expectation;
  });
});
