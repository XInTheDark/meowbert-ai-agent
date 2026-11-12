import type { LiveSyncFileVersionContent, LiveSyncFileVersionList } from "@meowbert/shared/live-sync-file-versions";
import { resolveWorkspaceSourceAccess } from "../sources/source-access.js";
import { findGoogleDriveFileInFolder, type GoogleDriveFileReference } from "./google-drive-file-lookup.js";
import type { DriveRequestContext } from "./google-drive-folder-query.js";
import { buildGoogleDriveResourceKeyHeader, decodeGoogleDriveItemReference } from "./google-drive-remote.js";
import { downloadGoogleDriveFileRevision, listGoogleDriveFileRevisions } from "./google-drive-revisions.js";
import { SourceFileLinkActionError } from "./provider-errors.js";
import { getTaskLiveSyncLinkMetadata } from "./task-link-metadata.js";

interface TaskLiveSyncFileTarget {
  taskId: string;
  // The linked file or folder as the task lists it.
  taskRelativePath: string;
  // The file's path inside a linked folder, or null when the link is the file itself.
  filePath: string | null;
}

async function resolveTaskDriveFile(input: TaskLiveSyncFileTarget): Promise<{ context: DriveRequestContext; file: GoogleDriveFileReference }> {
  const { link } = await getTaskLiveSyncLinkMetadata(input);
  if (link.provider !== "google-drive") {
    throw new SourceFileLinkActionError("Version history is only available for linked Google Drive files and folders.");
  }
  const access = await resolveWorkspaceSourceAccess({ workspaceId: link.workspaceId, provider: "google-drive" });
  const reference = decodeGoogleDriveItemReference(link.remoteItemId);
  const context = { accessToken: access.accessToken, headers: buildGoogleDriveResourceKeyHeader(reference) };

  if (link.linkKind === "file") {
    if (input.filePath) throw new SourceFileLinkActionError("This path is a linked file, not a folder.");
    return { context, file: { fileId: reference.itemId, name: link.remoteName, mimeType: link.remoteMimeType } };
  }
  if (!input.filePath) {
    throw new SourceFileLinkActionError("Folders have no version history. Give the path of a file inside the folder.");
  }
  return { context, file: await findGoogleDriveFileInFolder(context, { rootFolderId: reference.itemId, filePath: input.filePath }) };
}

export async function listTaskLiveSyncFileVersions(input: TaskLiveSyncFileTarget & {
  limit: number;
  modifiedBefore: string | null;
}): Promise<LiveSyncFileVersionList> {
  const { context, file } = await resolveTaskDriveFile(input);
  return listGoogleDriveFileRevisions(context, { file, limit: input.limit, modifiedBefore: input.modifiedBefore });
}

export async function readTaskLiveSyncFileVersion(input: TaskLiveSyncFileTarget & { versionId: string }): Promise<LiveSyncFileVersionContent> {
  const { context, file } = await resolveTaskDriveFile(input);
  return downloadGoogleDriveFileRevision(context, { file, versionId: input.versionId });
}
