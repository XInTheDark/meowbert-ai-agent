import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../../routes/environments/shared.js", () => ({
  createAvailableFilePath: vi.fn(),
  sanitizeUploadFilename: vi.fn((value: string) => value)
}));

vi.mock("../sources/file-import.js", () => ({
  importWorkspaceSourceFileToEnvironment: vi.fn()
}));

vi.mock("../sources/source-catalog.js", () => ({
  getSourceCatalogEntry: vi.fn()
}));

vi.mock("../sources/source-operations.js", () => ({
  downloadWorkspaceSourceFile: vi.fn()
}));

vi.mock("./folder-sync.js", () => ({
  mirrorLocalFolderToRemote: vi.fn(),
  mirrorRemoteFolderToLocal: vi.fn(),
  readRemoteFolderSnapshot: vi.fn()
}));

vi.mock("./local-file-state.js", () => ({
  readSourceFileLinkLocalSnapshot: vi.fn(),
  resolveSourceFileLinkAbsolutePath: vi.fn()
}));

vi.mock("./remote-provider.js", () => ({
  getSourceFileLinkRemoteProvider: vi.fn(),
  SourceFileLinkRemoteMissingError: class SourceFileLinkRemoteMissingError extends Error {}
}));

vi.mock("./status.js", () => ({
  buildSourceFileLinkStatus: vi.fn()
}));

vi.mock("./google-drive-mount-manager.js", () => ({
  acquireGoogleDriveFolderMount: vi.fn(),
  getGoogleDriveFolderMountConsumers: vi.fn(() => []),
  releaseGoogleDriveFolderMountsForConsumer: vi.fn(),
  unlinkGoogleDriveFolderMount: vi.fn()
}));

import { query } from "../../lib/db.js";
import { getGoogleDriveFolderMountConsumers, unlinkGoogleDriveFolderMount } from "./google-drive-mount-manager.js";
import { listTaskLiveSyncFileSummaries, unlinkSourceFileLinkByEnvironmentPath, unlinkSourceFileLinksUnderEnvironmentPaths } from "./service.js";

const mockedQuery = vi.mocked(query);
const mockedUnlinkGoogleDriveFolderMount = vi.mocked(unlinkGoogleDriveFolderMount);
const mockedGetGoogleDriveFolderMountConsumers = vi.mocked(getGoogleDriveFolderMountConsumers);

function queryResult<Row extends object>(rows: Row[]): QueryResult<Row> {
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

describe("listTaskLiveSyncFileSummaries", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedUnlinkGoogleDriveFolderMount.mockReset();
    mockedGetGoogleDriveFolderMountConsumers.mockReset();
    mockedGetGoogleDriveFolderMountConsumers.mockReturnValue([]);
  });

  it("includes live-sync project context links as listed context paths", async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM tasks t")) {
        return queryResult([{
          task_root_path: ".meowbert/task-runs/task-1",
          environment_id: "project-1",
          workspace_id: "workspace-1",
          environment_root_path: "/env",
          workspace_root_path: "/workspace"
        }]);
      }

      if (sql.includes("WHERE task_id = $1")) {
        return queryResult([
          linkRow({
            id: "task-link",
            local_relative_path: ".meowbert/task-runs/task-1/inputs/spec.docx"
          })
        ]);
      }

      if (sql.includes("WHERE environment_id = $1")) {
        return queryResult([
          linkRow({
            id: "context-link",
            remote_name: "Project Brief.docx",
            local_relative_path: "context/project-brief.docx"
          })
        ]);
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    const summaries = await listTaskLiveSyncFileSummaries({ taskId: "task-1" });

    expect(summaries.map((summary) => summary.taskRelativePath)).toEqual([
      "inputs/spec.docx",
      "context/project-brief.docx"
    ]);
    expect(summaries[1]).toMatchObject({
      id: "context-link",
      localRelativePath: "context/project-brief.docx"
    });
  });

  it("releases the attachment consumer when unlinking a project folder mount", async () => {
    mockedQuery
      .mockResolvedValueOnce(queryResult([{
        id: "link-1",
        workspace_id: "workspace-1",
        environment_id: "project-1",
        task_id: null,
        provider: "google-drive",
        source_id: "google-drive",
        link_kind: "folder",
        remote_item_id: "folder-1",
        remote_name: "Project docs",
        remote_mime_type: "application/vnd.google-apps.folder",
        remote_web_url: null,
        local_relative_path: "context/docs",
        sync_mode: "manual",
        last_synced_remote_etag: null,
        last_synced_remote_ctag: null,
        last_synced_remote_modified_at: null,
        last_synced_remote_size_bytes: null,
        last_synced_local_hash: null,
        last_synced_local_size_bytes: null,
        last_synced_local_modified_at: null,
        last_pulled_at: null,
        last_pushed_at: null,
        last_sync_error: null,
        created_by_user_id: "user-1",
        updated_by_user_id: "user-1",
        created_at: "2026-09-14T00:00:00.000Z",
        updated_at: "2026-09-14T00:00:00.000Z"
      }]))
      .mockResolvedValueOnce(queryResult([]));

    await unlinkSourceFileLinkByEnvironmentPath({
      environmentId: "project-1",
      localRelativePath: "context/docs"
    });

    expect(mockedUnlinkGoogleDriveFolderMount).toHaveBeenCalledWith("link-1", "attachment:user-1");
  });

  it("unlinks mounted descendants before deleting a selected parent path", async () => {
    mockedQuery
      .mockResolvedValueOnce(queryResult([
        {
          id: "link-parent",
          workspace_id: "workspace-1",
          environment_id: "project-1",
          task_id: null,
          provider: "google-drive",
          source_id: "google-drive",
          link_kind: "folder",
          remote_item_id: "folder-parent",
          remote_name: "Docs",
          remote_mime_type: "application/vnd.google-apps.folder",
          remote_web_url: null,
          local_relative_path: "context/docs",
          sync_mode: "manual",
          last_synced_remote_etag: null,
          last_synced_remote_ctag: null,
          last_synced_remote_modified_at: null,
          last_synced_remote_size_bytes: null,
          last_synced_local_hash: null,
          last_synced_local_size_bytes: null,
          last_synced_local_modified_at: null,
          last_pulled_at: null,
          last_pushed_at: null,
          last_sync_error: null,
          created_by_user_id: "user-1",
          updated_by_user_id: "user-1",
          created_at: "2026-09-14T00:00:00.000Z",
          updated_at: "2026-09-14T00:00:00.000Z"
        },
        {
          id: "link-child",
          workspace_id: "workspace-1",
          environment_id: "project-1",
          task_id: null,
          provider: "google-drive",
          source_id: "google-drive",
          link_kind: "folder",
          remote_item_id: "folder-child",
          remote_name: "Nested",
          remote_mime_type: "application/vnd.google-apps.folder",
          remote_web_url: null,
          local_relative_path: "context/docs/nested",
          sync_mode: "manual",
          last_synced_remote_etag: null,
          last_synced_remote_ctag: null,
          last_synced_remote_modified_at: null,
          last_synced_remote_size_bytes: null,
          last_synced_local_hash: null,
          last_synced_local_size_bytes: null,
          last_synced_local_modified_at: null,
          last_pulled_at: null,
          last_pushed_at: null,
          last_sync_error: null,
          created_by_user_id: "user-1",
          updated_by_user_id: "user-1",
          created_at: "2026-09-14T00:00:00.000Z",
          updated_at: "2026-09-14T00:00:00.000Z"
        }
      ]))
      .mockResolvedValue(queryResult([]));

    await unlinkSourceFileLinksUnderEnvironmentPaths({
      environmentId: "project-1",
      localRelativePaths: ["context"]
    });

    expect(mockedUnlinkGoogleDriveFolderMount).toHaveBeenNthCalledWith(1, "link-parent", "attachment:user-1");
    expect(mockedUnlinkGoogleDriveFolderMount).toHaveBeenNthCalledWith(2, "link-child", "attachment:user-1");
  });

  it("refuses parent deletion while a task still holds a descendant mount", async () => {
    mockedQuery.mockResolvedValueOnce(queryResult([{
      id: "link-child",
      workspace_id: "workspace-1",
      environment_id: "project-1",
      task_id: null,
      provider: "google-drive",
      source_id: "google-drive",
      link_kind: "folder",
      remote_item_id: "folder-child",
      remote_name: "Nested",
      remote_mime_type: "application/vnd.google-apps.folder",
      remote_web_url: null,
      local_relative_path: "context/docs/nested",
      sync_mode: "manual",
      last_synced_remote_etag: null,
      last_synced_remote_ctag: null,
      last_synced_remote_modified_at: null,
      last_synced_remote_size_bytes: null,
      last_synced_local_hash: null,
      last_synced_local_size_bytes: null,
      last_synced_local_modified_at: null,
      last_pulled_at: null,
      last_pushed_at: null,
      last_sync_error: null,
      created_by_user_id: "user-1",
      updated_by_user_id: "user-1",
      created_at: "2026-09-14T00:00:00.000Z",
      updated_at: "2026-09-14T00:00:00.000Z"
    }]));
    mockedGetGoogleDriveFolderMountConsumers.mockReturnValue(["task-1:user-1"]);

    await expect(unlinkSourceFileLinksUnderEnvironmentPaths({
      environmentId: "project-1",
      localRelativePaths: ["context"]
    })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("running task")
    });
    expect(mockedUnlinkGoogleDriveFolderMount).not.toHaveBeenCalled();
  });
});
