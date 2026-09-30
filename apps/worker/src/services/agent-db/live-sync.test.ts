import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import { listTaskLiveSyncFilesForWorker } from "./live-sync.js";

const mockedQuery = vi.mocked(query);

function queryResult<Row extends object>(rows: Row[]) {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}

function linkRow(overrides: Record<string, unknown>) {
  return {
    id: "link-1",
    provider: "google-drive",
    source_id: "google-drive",
    link_kind: "file",
    remote_name: "Spec.docx",
    remote_web_url: "https://example.com/spec",
    local_relative_path: ".meowbert/task-runs/task-1/inputs/spec.docx",
    last_pulled_at: null,
    last_pushed_at: null,
    last_sync_error: null,
    ...overrides
  };
}

describe("listTaskLiveSyncFilesForWorker", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("exposes project context live-sync links as context paths", async () => {
    mockedQuery.mockResolvedValue(queryResult([
      linkRow({
        id: "task-link",
        local_relative_path: ".meowbert/task-runs/task-1/inputs/spec.docx"
      }),
      linkRow({
        id: "context-link",
        remote_name: "Project Brief.docx",
        local_relative_path: "context/project-brief.docx"
      })
    ]));

    const files = await listTaskLiveSyncFilesForWorker({
      taskId: "task-1",
      workspaceId: "workspace-1",
      environmentId: "project-1",
      taskRootPath: ".meowbert/task-runs/task-1"
    });

    expect(files.map((file) => file.taskRelativePath)).toEqual([
      "inputs/spec.docx",
      "context/project-brief.docx"
    ]);
    expect(files[1]).toMatchObject({
      id: "context-link",
      localRelativePath: "context/project-brief.docx"
    });
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("environment_id = $3"),
      ["task-1", "workspace-1", "project-1"]
    );
  });
});
