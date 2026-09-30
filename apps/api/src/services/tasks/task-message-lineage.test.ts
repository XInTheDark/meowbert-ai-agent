import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import { findNearestUserAncestorMessage, listTaskMessageLineageIds } from "./task-message-lineage.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("findNearestUserAncestorMessage", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the closest user ancestor for a message", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([
      {
        id: "user-1",
        content_json: { text: "hello" },
        parent_message_id: "assistant-0"
      }
    ]));

    await expect(findNearestUserAncestorMessage("task-1", "assistant-1")).resolves.toEqual({
      id: "user-1",
      content_json: { text: "hello" },
      parent_message_id: "assistant-0"
    });
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("WITH RECURSIVE lineage AS"), ["task-1", "assistant-1"]);
  });

  it("returns null when the lineage has no user message", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([]));

    await expect(findNearestUserAncestorMessage("task-1", "assistant-1")).resolves.toBeNull();
  });
});

describe("listTaskMessageLineageIds", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns message ids from the task root to the requested message", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([
      { id: "root-user" },
      { id: "assistant-1" },
      { id: "assistant-2" }
    ]));

    await expect(listTaskMessageLineageIds("task-1", "assistant-2")).resolves.toEqual([
      "root-user",
      "assistant-1",
      "assistant-2"
    ]);
    expect(mockedQuery).toHaveBeenCalledWith(expect.stringContaining("ORDER BY depth DESC"), ["task-1", "assistant-2"]);
  });

  it("returns an empty list when the message cannot be found", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([]));

    await expect(listTaskMessageLineageIds("task-1", "missing-message")).resolves.toEqual([]);
  });
});
