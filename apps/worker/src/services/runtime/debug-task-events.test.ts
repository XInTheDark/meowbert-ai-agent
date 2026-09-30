import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("./events.js", () => ({
  emitTaskEvent: vi.fn()
}));

import { query } from "../../lib/db.js";
import { emitTaskEvent } from "./events.js";
import { createTaskDebugLogger, resetTaskDebugModeCacheForTests } from "./debug-task-events.js";

function buildRowsResult<Row extends Record<string, unknown>>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("createTaskDebugLogger", () => {
  const mockedQuery = vi.mocked(query);
  const mockedEmitTaskEvent = vi.mocked(emitTaskEvent);

  beforeEach(() => {
    vi.clearAllMocks();
    resetTaskDebugModeCacheForTests();
  });

  it("does not emit events when debug mode is disabled", async () => {
    mockedQuery.mockResolvedValue(buildRowsResult([{ debug_mode: false }]) as never);

    const logger = createTaskDebugLogger("task-1");
    await logger.log("Should stay hidden.");

    expect(mockedEmitTaskEvent).not.toHaveBeenCalled();
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it("emits stage start and success logs when debug mode is enabled", async () => {
    mockedQuery.mockResolvedValue(buildRowsResult([{ debug_mode: true }]) as never);

    const logger = createTaskDebugLogger("task-1");
    const result = await logger.stage({
      stage: "startup.snapshot",
      startMessage: "Loading task snapshot.",
      successMessage: "Loaded task snapshot.",
      run: async () => "ok",
      successPayload: {
        messageCount: 3
      }
    });

    expect(result).toBe("ok");
    expect(mockedEmitTaskEvent).toHaveBeenNthCalledWith(1, "task-1", "log", {
      message: "Loading task snapshot.",
      stage: "startup.snapshot",
      phase: "start"
    });
    expect(mockedEmitTaskEvent).toHaveBeenNthCalledWith(2, "task-1", "log", expect.objectContaining({
      message: "Loaded task snapshot.",
      stage: "startup.snapshot",
      phase: "success",
      messageCount: 3,
      durationMs: expect.any(Number)
    }));
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached debug-mode lookup for multiple logs", async () => {
    mockedQuery.mockResolvedValue(buildRowsResult([{ debug_mode: true }]) as never);

    const logger = createTaskDebugLogger("task-1");
    await logger.log("First message.");
    await logger.log("Second message.");

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(mockedEmitTaskEvent).toHaveBeenCalledTimes(2);
  });
});
