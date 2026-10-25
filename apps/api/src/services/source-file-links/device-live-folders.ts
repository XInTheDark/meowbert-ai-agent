import path from "node:path";
import { query } from "../../lib/db.js";
import { sanitizeUploadFilename } from "../files/file-paths.js";
import { getWorkspaceSourceConnection } from "../sources/workspace-source-connections.js";
import { loadWorkspaceFileHost } from "../workspaces/workspace-file-host.js";
import { fetchGoogleDriveRemoteSnapshot } from "./google-drive-remote.js";
import { createSourceFileLink } from "./store.js";
import type { WorkspaceSourceAttachment } from "../sources/source-attachments.js";

export async function createDeviceLiveFolderAttachment(input: {
  workspaceId: string; environmentId: string; actorUserId: string; sourceId: string; itemId: string;
  taskId?: string | null; destinationPath?: string | null;
}): Promise<WorkspaceSourceAttachment> {
  const host = await loadWorkspaceFileHost(input.workspaceId);
  if (host.kind !== "device") throw new Error("A device-hosted workspace is required.");
  const device = await query("SELECT id FROM devices WHERE id = $1 AND user_id = $2 AND platform = 'darwin' AND revoked_at IS NULL", [host.deviceId, input.actorUserId]);
  if (!device.rows.length) throw Object.assign(new Error("Live Drive folders require the owner's macOS device."), { statusCode: 409 });
  const connection = await getWorkspaceSourceConnection(input.workspaceId, "google-drive");
  if (connection?.updatedByUserId !== input.actorUserId) throw Object.assign(new Error("Only the user who connected Google Drive can attach live folders."), { statusCode: 403 });
  const target = await query<{ task_root_path: string | null; task_environment_id: string | null; task_workspace_id: string | null }>(
    "SELECT t.task_root_path, t.environment_id AS task_environment_id, t.workspace_id AS task_workspace_id FROM environments e LEFT JOIN tasks t ON t.id = $3 WHERE e.id = $1 AND e.workspace_id = $2",
    [input.environmentId, input.workspaceId, input.taskId ?? null]
  );
  const task = target.rows[0];
  if (!task || (task.task_workspace_id && (task.task_environment_id !== input.environmentId || task.task_workspace_id !== input.workspaceId))) throw new Error("The attachment target is unavailable.");
  const base = task.task_root_path ?? (input.taskId ? ".meowbert/task-runs/" + input.taskId : "context");
  const directory = path.posix.normalize(input.destinationPath?.trim().replace(/\\/g, "/") || base);
  if (directory !== base && !directory.startsWith(base + "/")) throw new Error("The live-folder destination must stay within the task or Project Context.");
  const remote = await fetchGoogleDriveRemoteSnapshot({ workspaceId: input.workspaceId, sourceId: input.sourceId, itemId: input.itemId, requireWriteAccess: true });
  if (remote.kind !== "folder") throw new Error("Device-hosted workspaces support live Google Drive folders only.");
  const relativePath = path.posix.join(directory, sanitizeUploadFilename(remote.name));
  const link = await createSourceFileLink({ ...input, taskId: input.taskId ?? null, provider: "google-drive", linkKind: "folder", remoteItemId: remote.itemId,
    remoteName: remote.name, remoteMimeType: remote.mimeType, remoteWebUrl: remote.webUrl, localRelativePath: relativePath,
    lastSyncedRemoteEtag: null, lastSyncedRemoteCtag: null, lastSyncedRemoteModifiedAt: null, lastSyncedRemoteSizeBytes: null,
    lastSyncedLocalHash: null, lastSyncedLocalSizeBytes: null, lastSyncedLocalModifiedAt: null });
  return { kind: "directory", name: path.posix.basename(relativePath), relativePath, sizeBytes: null, createdAt: null, modifiedAt: null,
    liveSync: { id: link.id, provider: link.provider, sourceId: link.sourceId, linkKind: link.linkKind, remoteName: link.remoteName,
      remoteWebUrl: link.remoteWebUrl, localRelativePath: link.localRelativePath, lastPulledAt: null, lastPushedAt: null, lastSyncError: null } };
}
