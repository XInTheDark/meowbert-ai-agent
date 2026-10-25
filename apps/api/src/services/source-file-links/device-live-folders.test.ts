import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../workspaces/workspace-file-host.js", () => ({ loadWorkspaceFileHost: vi.fn() }));
vi.mock("../sources/workspace-source-connections.js", () => ({ getWorkspaceSourceConnection: vi.fn() }));
vi.mock("./google-drive-remote.js", () => ({ fetchGoogleDriveRemoteSnapshot: vi.fn() }));
vi.mock("./store.js", () => ({ createSourceFileLink: vi.fn() }));
import { query } from "../../lib/db.js";
import { loadWorkspaceFileHost } from "../workspaces/workspace-file-host.js";
import { getWorkspaceSourceConnection } from "../sources/workspace-source-connections.js";
import { fetchGoogleDriveRemoteSnapshot } from "./google-drive-remote.js";
import { createSourceFileLink } from "./store.js";
import { createDeviceLiveFolderAttachment } from "./device-live-folders.js";
const input = { workspaceId: "workspace", environmentId: "project", actorUserId: "owner", sourceId: "google-drive", itemId: "remote", taskId: null };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadWorkspaceFileHost).mockResolvedValue({ kind: "device", deviceId: "device" });
  vi.mocked(query).mockImplementation(async (sql: string) => ({ rows: sql.startsWith("SELECT id FROM devices") ? [{ id: "device" }]
    : [{ task_root_path: null, task_environment_id: null, task_workspace_id: null }] }) as never);
  vi.mocked(getWorkspaceSourceConnection).mockResolvedValue({ updatedByUserId: "owner" } as never);
  vi.mocked(fetchGoogleDriveRemoteSnapshot).mockResolvedValue({ kind: "folder", name: "Drive", itemId: "remote" } as never);
  vi.mocked(createSourceFileLink).mockImplementation(async (value) => ({ ...value, id: "link" }) as never);
});

it("attaches a Drive folder using metadata while preserving its project context path", async () => {
  expect(await createDeviceLiveFolderAttachment(input)).toMatchObject({ kind: "directory", relativePath: "context/Drive", liveSync: { id: "link" } });
  expect(createSourceFileLink).toHaveBeenCalledWith(expect.objectContaining({ localRelativePath: "context/Drive", remoteItemId: "remote", taskId: null }));
});

it("denies another connecting user and a task outside the selected project before saving metadata", async () => {
  vi.mocked(getWorkspaceSourceConnection).mockResolvedValueOnce({ updatedByUserId: "someone-else" } as never);
  await expect(createDeviceLiveFolderAttachment(input)).rejects.toMatchObject({ statusCode: 403 });
  vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: "device" }] } as never)
    .mockResolvedValueOnce({ rows: [{ task_root_path: null, task_environment_id: "other-project", task_workspace_id: "workspace" }] } as never);
  await expect(createDeviceLiveFolderAttachment({ ...input, taskId: "existing-task" })).rejects.toThrow("target is unavailable");
  expect(createSourceFileLink).not.toHaveBeenCalled();
});

it("refuses ordinary files and destinations outside task or context scope", async () => {
  vi.mocked(fetchGoogleDriveRemoteSnapshot).mockResolvedValueOnce({ kind: "file", name: "file.txt" } as never);
  await expect(createDeviceLiveFolderAttachment(input)).rejects.toThrow("folders only");
  await expect(createDeviceLiveFolderAttachment({ ...input, destinationPath: "../elsewhere" })).rejects.toThrow("within the task or Project Context");
  expect(createSourceFileLink).not.toHaveBeenCalled();
});
