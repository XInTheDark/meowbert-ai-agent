import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));
vi.mock("../environments/environment-storage.js", () => ({
  ensureEnvironmentStorageRoot: vi.fn()
}));
vi.mock("./task-history.js", () => ({
  deleteTaskHistoryArchive: vi.fn()
}));

import { deleteTaskTreesInTx, TaskDeletionConflictError } from "./task-cleanup.js";

function buildRowsResult<Row extends object>(rows: Row[]) {
  return { rows, rowCount: rows.length };
}

describe("deleteTaskTreesInTx", () => {
  it("collects workflow-linked descendants before deleting the task tree", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([
        { id: "root", environment_id: "environment-1", task_root_path: "root-path", task_history_archive_key: null },
        { id: "reviewer", environment_id: "environment-1", task_root_path: "reviewer-path", task_history_archive_key: null }
      ]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ fs_path: "/tmp/reviewer-workspace" }]))
      .mockResolvedValueOnce(buildRowsResult([]));

    const deleted = await deleteTaskTreesInTx({ query } as never, ["root"]);

    expect(deleted.taskIds).toEqual(["root", "reviewer"]);
    expect(query.mock.calls[0][0]).toEqual(expect.stringContaining(
      "child.parent_task_id = parent.id\n           OR child.workflow_parent_task_id = parent.id"
    ));
    expect(query.mock.calls[4][0]).toEqual(expect.stringContaining("DELETE FROM tasks"));
  });

  it("refuses to delete a tree while a descendant is active", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(buildRowsResult([
        { id: "root", environment_id: "environment-1", task_root_path: "root-path", task_history_archive_key: null },
        { id: "worker", environment_id: "environment-1", task_root_path: "worker-path", task_history_archive_key: null }
      ]))
      .mockResolvedValueOnce(buildRowsResult([]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "worker" }]));

    await expect(deleteTaskTreesInTx({ query } as never, ["root"]))
      .rejects.toBeInstanceOf(TaskDeletionConflictError);
    expect(query).toHaveBeenCalledTimes(3);
  });
});
