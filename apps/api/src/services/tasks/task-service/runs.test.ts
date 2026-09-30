import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  queueAdd: vi.fn()
}));

vi.mock("../../../lib/db.js", () => ({ withTransaction: mocks.withTransaction }));
vi.mock("../../../lib/queue.js", () => ({ taskQueue: { add: mocks.queueAdd } }));

import { enqueueRun } from "./runs.js";

function buildRowsResult<Row extends object>(rows: Row[]) {
  return { rows, rowCount: rows.length };
}

describe("enqueueRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves compaction status and carries branch context into dispatch", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT id") && sql.includes("FROM tasks") && sql.includes("FOR UPDATE")) {
          return buildRowsResult([{ id: "task-1" }]);
        }
        if (sql.includes("SELECT is_super_admin")) {
          return buildRowsResult([{ is_super_admin: false }]);
        }
        if (sql.includes("SELECT COALESCE(MAX(attempt_no)")) {
          return buildRowsResult([{ attempt_no: 4 }]);
        }
        return buildRowsResult([]);
      })
    };
    mocks.withTransaction.mockImplementation(async (callback) => callback(client));

    await enqueueRun({
      taskId: "task-1",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      triggerSource: "web",
      mode: "compact_only",
      restoreStatus: "succeeded",
      contextAction: "clear",
      branchMessageId: "leaf-1",
      selectionUserId: "user-1",
      priorityActorUserId: "user-1",
      dispatchCategory: "followup"
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("trashed_at = CASE WHEN $2 = 'compact_only' THEN trashed_at ELSE NULL END"),
      ["task-1", "compact_only"]
    );
    const dispatchCall = client.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO task_run_dispatches"));
    const payload = JSON.parse(String(dispatchCall?.[1]?.[5])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      mode: "compact_only",
      restoreStatus: "succeeded",
      branchMessageId: "leaf-1",
      selectionUserId: "user-1",
      contextAction: "clear"
    });
  });
});
