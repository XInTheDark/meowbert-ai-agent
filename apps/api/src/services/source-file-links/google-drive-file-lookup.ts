import path from "node:path";
import { SourceFileLinkActionError } from "./provider-errors.js";
import {
  FOLDER_MIME_TYPE,
  SHORTCUT_MIME_TYPE,
  effectiveMimeType,
  listDriveFiles,
  quoteDriveLiteral,
  toMountedEntryName,
  type DriveRequestContext
} from "./google-drive-folder-query.js";
import { resolveSubfolderId } from "./google-drive-subtree-folders.js";

export interface GoogleDriveFileReference {
  fileId: string;
  name: string;
  mimeType: string | null;
}

// Mounted native Google files carry a `.url` suffix, and `／` stands in for `/` in names.
function candidateDriveNames(entryName: string): string[] {
  const name = entryName.replace(/／/g, "/");
  return name.endsWith(".url") && name.length > ".url".length ? [name, name.slice(0, -".url".length)] : [name];
}

export function splitMountedFilePath(filePath: string): { folder: string | null; entryName: string } {
  const normalized = path.posix.normalize(filePath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new SourceFileLinkActionError("The file path must stay inside the linked folder.");
  }
  const folder = path.posix.dirname(normalized);
  return { folder: folder === "." ? null : folder, entryName: path.posix.basename(normalized) };
}

// Finds the Drive file that the folder mount shows at `filePath`, matching names the way the mount writes them.
export async function findGoogleDriveFileInFolder(context: DriveRequestContext, input: {
  rootFolderId: string;
  filePath: string;
}): Promise<GoogleDriveFileReference> {
  const { folder, entryName } = splitMountedFilePath(input.filePath);
  const parentId = await resolveSubfolderId(context, input.rootFolderId, folder);
  const nameClause = candidateDriveNames(entryName).map((name) => `name = ${quoteDriveLiteral(name)}`).join(" or ");
  const page = await listDriveFiles(context, {
    q: `trashed = false and mimeType != '${FOLDER_MIME_TYPE}' and (${nameClause}) and ${quoteDriveLiteral(parentId)} in parents`,
    fields: "id,name,mimeType,shortcutDetails",
    pageSize: 20,
    orderBy: "modifiedTime desc",
    pageToken: null
  });
  const match = page.files.find((item) => toMountedEntryName(item) === entryName);
  if (!match?.id || !match.name) {
    throw new SourceFileLinkActionError(`File not found in Google Drive: ${input.filePath}`);
  }
  const isShortcut = match.mimeType === SHORTCUT_MIME_TYPE;
  const fileId = isShortcut ? match.shortcutDetails?.targetId : match.id;
  if (!fileId || effectiveMimeType(match) === FOLDER_MIME_TYPE) {
    throw new SourceFileLinkActionError(`Not a file in Google Drive: ${input.filePath}`);
  }
  return { fileId, name: match.name, mimeType: effectiveMimeType(match) };
}
