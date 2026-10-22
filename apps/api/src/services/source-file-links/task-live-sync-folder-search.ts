import path from "node:path";
import { resolveWorkspaceSourceAccess } from "../sources/source-access.js";
import {
  searchGoogleDriveFolderSubtree,
  type GoogleDriveFolderSearchFilters,
  type GoogleDriveFolderSearchResult
} from "./google-drive-folder-search.js";
import { SourceFileLinkActionError } from "./provider-errors.js";
import { getTaskLiveSyncLinkByTaskPath } from "./service.js";

function normalizeSubfolder(value: string | null): string | null {
  const trimmed = value?.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") ?? "";
  if (!trimmed) {
    return null;
  }
  const normalized = path.posix.normalize(trimmed);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new SourceFileLinkActionError("The subfolder must stay inside the linked folder.");
  }
  return normalized;
}

export async function searchTaskLiveSyncFolderByTaskPath(input: {
  taskId: string;
  taskRelativePath: string;
  subfolder: string | null;
  filters: GoogleDriveFolderSearchFilters;
}): Promise<GoogleDriveFolderSearchResult & { folder: string }> {
  const { link } = await getTaskLiveSyncLinkByTaskPath(input);
  if (link.provider !== "google-drive" || link.linkKind !== "folder") {
    throw new SourceFileLinkActionError("Folder search is only available for linked Google Drive folders.");
  }

  const subfolder = normalizeSubfolder(input.subfolder);
  const access = await resolveWorkspaceSourceAccess({
    workspaceId: link.workspaceId,
    provider: "google-drive"
  });
  const result = await searchGoogleDriveFolderSubtree({
    accessToken: access.accessToken,
    rootItemId: link.remoteItemId,
    subfolder,
    filters: input.filters
  });
  const folder = subfolder ? `${input.taskRelativePath}/${subfolder}` : input.taskRelativePath;
  return {
    ...result,
    folder,
    items: result.items.map((item) => ({ ...item, path: `${folder}/${item.path}` }))
  };
}
