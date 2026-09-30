import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRemoteSnapshot } = vi.hoisted(() => ({
  fetchRemoteSnapshot: vi.fn(async () => ({ itemId: "folder-1", kind: "folder" as const, name: "Notes" }))
}));

vi.mock("node:fs/promises", () => ({
  default: { realpath: vi.fn(async () => "/project") }
}));
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../../routes/environments/shared.js", () => ({
  createAvailableFilePath: vi.fn(async (value: string) => value),
  sanitizeUploadFilename: vi.fn((value: string) => value)
}));
vi.mock("../sources/source-catalog.js", () => ({
  getSourceCatalogEntry: vi.fn(() => ({ provider: "google-drive" }))
}));
vi.mock("../sources/source-operations.js", () => ({ downloadWorkspaceSourceFile: vi.fn() }));
vi.mock("./store.js", () => ({
  createSourceFileLink: vi.fn(async (input) => ({ ...input, id: "link-1" })),
  deleteSourceFileLink: vi.fn(async () => undefined),
  getSourceFileLinkByEnvironmentPath: vi.fn(async () => ({ provider: "google-drive", linkKind: "folder" })),
  listSourceFileLinksForEnvironmentPaths: vi.fn()
}));
vi.mock("./remote-provider.js", () => ({
  getSourceFileLinkRemoteProvider: vi.fn(() => ({
    fetchRemoteSnapshot
  }))
}));
vi.mock("./folder-sync.js", () => ({ mirrorRemoteFolderToLocal: vi.fn() }));
vi.mock("./local-file-state.js", () => ({ readSourceFileLinkLocalSnapshot: vi.fn() }));
vi.mock("./google-drive-mount-manager.js", () => ({ acquireGoogleDriveFolderMount: vi.fn() }));

import { createLiveSyncSourceAttachment, ensureTaskSourceFolderMounts, getSourceFileLinkStatusByEnvironmentPath, pullSourceFileLinkByEnvironmentPath, pushSourceFileLinkByEnvironmentPath } from "./service.js";
import { acquireGoogleDriveFolderMount } from "./google-drive-mount-manager.js";
import { mirrorRemoteFolderToLocal } from "./folder-sync.js";
import { readSourceFileLinkLocalSnapshot } from "./local-file-state.js";
import { downloadWorkspaceSourceFile } from "../sources/source-operations.js";
import { deleteSourceFileLink, listSourceFileLinksForEnvironmentPaths } from "./store.js";
import { query } from "../../lib/db.js";
import type { SourceFileLink } from "./types.js";
import { SourceFileLinkProviderError } from "./provider-errors.js";

const input = {
  workspaceId: "workspace-1",
  environmentId: "project-1",
  environmentRootPath: "/project",
  workspaceRootPath: "/workspace",
  actorUserId: "user-1",
  sourceId: "google-drive",
  itemId: "folder-1",
  destinationPath: "context"
};

describe("Google Drive folder attachment", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("mounts without copying the folder or hashing its contents", async () => {
    await expect(createLiveSyncSourceAttachment(input)).resolves.toMatchObject({
      kind: "directory",
      relativePath: "context/Notes",
      sizeBytes: null
    });
    expect(acquireGoogleDriveFolderMount).toHaveBeenCalledWith({
      link: expect.objectContaining({ remoteItemId: "folder-1", linkKind: "folder" }),
      consumerId: "attachment:user-1",
      mountPoint: "/project/context/Notes"
    });
    expect(mirrorRemoteFolderToLocal).not.toHaveBeenCalled();
    expect(downloadWorkspaceSourceFile).not.toHaveBeenCalled();
    expect(readSourceFileLinkLocalSnapshot).not.toHaveBeenCalled();
  });

  it("removes a failed attachment link and preserves the actionable error", async () => {
    const error = new SourceFileLinkProviderError("FUSE is unavailable", { statusCode: 503 });
    vi.mocked(acquireGoogleDriveFolderMount).mockRejectedValueOnce(error);
    await expect(createLiveSyncSourceAttachment(input)).rejects.toBe(error);
    expect(deleteSourceFileLink).toHaveBeenCalledWith("link-1");
    expect(mirrorRemoteFolderToLocal).not.toHaveBeenCalled();
  });

  it("reports the remote metadata stage when Drive metadata cannot be read", async () => {
    fetchRemoteSnapshot.mockRejectedValueOnce(new SourceFileLinkProviderError("Drive metadata unavailable", { statusCode: 503 }));

    await expect(createLiveSyncSourceAttachment(input)).rejects.toMatchObject({
      stage: "remote metadata",
      statusCode: 503,
      message: expect.stringContaining("remote metadata")
    });
    expect(acquireGoogleDriveFolderMount).not.toHaveBeenCalled();
  });

  it("restores task input folders as well as shared context before each run", async () => {
    const paths = [".meowbert/task-runs/task-1/inputs/Notes", "context/Shared"];
    vi.mocked(query).mockResolvedValueOnce({ rowCount: 1, rows: [{
      task_root_path: ".meowbert/task-runs/task-1", environment_id: "project-1",
      workspace_id: "workspace-1", environment_root_path: "/project", workspace_root_path: "/workspace"
    }] } as never).mockResolvedValueOnce({ rows: paths.map((local_relative_path) => ({ local_relative_path })) } as never);
    vi.mocked(listSourceFileLinksForEnvironmentPaths).mockResolvedValue(paths.map((localRelativePath) => ({
      id: localRelativePath, provider: "google-drive", localRelativePath
    })) as SourceFileLink[]);
    vi.mocked(acquireGoogleDriveFolderMount).mockImplementationOnce(async (value) => value.mountPoint)
      .mockImplementationOnce(async (value) => value.mountPoint);

    await expect(ensureTaskSourceFolderMounts({ taskId: "task-1", consumerId: "run-1" }))
      .resolves.toEqual(paths.map((value) => `/project/${value}`));
    const [sql, params] = vi.mocked(query).mock.calls[1];
    expect(sql).toContain("task_id = $3 OR (task_id IS NULL");
    expect(params).toEqual(["project-1", "workspace-1", "task-1"]);
    expect(listSourceFileLinksForEnvironmentPaths).toHaveBeenCalledWith("project-1", paths);
    expect(acquireGoogleDriveFolderMount).toHaveBeenCalledTimes(2);
    expect(mirrorRemoteFolderToLocal).not.toHaveBeenCalled();
  });

  it.each([
    getSourceFileLinkStatusByEnvironmentPath,
    pullSourceFileLinkByEnvironmentPath,
    pushSourceFileLinkByEnvironmentPath
  ])("rejects manual sync operations without traversing the mounted folder", async (action) => {
    await expect(action({ ...input, localRelativePath: "context/Notes", force: true })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("Manual status, pull, and push do not apply")
    });
    expect(readSourceFileLinkLocalSnapshot).not.toHaveBeenCalled();
    expect(mirrorRemoteFolderToLocal).not.toHaveBeenCalled();
  });
});
