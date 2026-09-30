import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskStatus } from "@meowbert/shared";

vi.mock("../../lib/db.js", () => ({
  withTransaction: vi.fn()
}));

vi.mock("../runtime/events.js", () => ({
  emitTaskEvent: vi.fn()
}));

import { withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import { finalizeUnhandledRunFailure } from "./run-failure-fallback.js";

type MockQueryResult<Row extends Record<string, unknown>> = {
  rows: Row[];
  rowCount: number;
};

function buildRowsResult<Row extends Record<string, unknown>>(rows: Row[]): MockQueryResult<Row> {
  return {
    rows,
    rowCount: rows.length
  };
}

describe("finalizeUnhandledRunFailure", () => {
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedEmitTaskEvent = vi.mocked(emitTaskEvent);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the latest open run and task as failed and emits fallback events", async () => {
    const queryMock = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{ task_id: "task-1", ended_at: null }]))
      .mockResolvedValueOnce(buildRowsResult([{ status: "running" as TaskStatus }]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "run-1" }]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "leaf-1" }]))
      .mockResolvedValueOnce(buildRowsResult([]));

    mockedWithTransaction.mockImplementationOnce(async (callback) => callback({ query: queryMock } as never));

    const result = await finalizeUnhandledRunFailure({
      taskId: "task-1",
      runId: "run-1",
      error: new Error("boom")
    });

    expect(result).toEqual({ finalized: true, taskMarkedFailed: true });
    expect(mockedEmitTaskEvent).toHaveBeenCalledTimes(2);
    expect(mockedEmitTaskEvent).toHaveBeenNthCalledWith(1, "task-1", "status", { status: "failed" });
    expect(mockedEmitTaskEvent).toHaveBeenNthCalledWith(2, "task-1", "error", {
      message: "boom",
      runId: "run-1",
      source: "worker_failed_fallback"
    });

    const insertMessageParams = queryMock.mock.calls[6]?.[1] as unknown[] | undefined;
    expect(insertMessageParams?.[1]).toBe(JSON.stringify({ text: "Task failed: boom" }));
    expect(insertMessageParams?.[3]).toBe("leaf-1");
  });

  it("records run completion but does not touch task state when a newer run is open", async () => {
    const queryMock = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{ task_id: "task-1", ended_at: null }]))
      .mockResolvedValueOnce(buildRowsResult([{ status: "running" as TaskStatus }]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "run-2" }]))
      .mockResolvedValueOnce(buildRowsResult([]));

    mockedWithTransaction.mockImplementationOnce(async (callback) => callback({ query: queryMock } as never));

    const result = await finalizeUnhandledRunFailure({
      taskId: "task-1",
      runId: "run-1",
      error: new Error("boom")
    });

    expect(result).toEqual({ finalized: true, taskMarkedFailed: false });
    expect(mockedEmitTaskEvent).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(4);
  });

  it("no-ops when the run was already finalized", async () => {
    const queryMock = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([{ task_id: "task-1", ended_at: "2026-03-02T00:00:00.000Z" }]));

    mockedWithTransaction.mockImplementationOnce(async (callback) => callback({ query: queryMock } as never));

    const result = await finalizeUnhandledRunFailure({
      taskId: "task-1",
      runId: "run-1",
      error: new Error("boom")
    });

    expect(result).toEqual({ finalized: false, taskMarkedFailed: false });
    expect(mockedEmitTaskEvent).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
