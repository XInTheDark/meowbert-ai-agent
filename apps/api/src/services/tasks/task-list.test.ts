import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import { listProjectTasks } from "./task-list.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("listProjectTasks", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes hidden tasks from the Project task list", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([]));

    await listProjectTasks({
      projectId: "project-1",
      actorUserId: "user-1",
      filters: {
        query: null,
        status: null,
        taskType: null,
        scope: "active",
        sortBy: "updated_at",
        sortDir: "desc",
        page: 1,
        pageSize: 25,
        folderMode: "all",
        folderId: null,
        includePreview: false
      }
    });

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("t.is_hidden = false"),
      expect.any(Array)
    );
  });
});
