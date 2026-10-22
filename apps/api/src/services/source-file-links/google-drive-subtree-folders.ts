import { SourceFileLinkActionError } from "./provider-errors.js";
import {
  FOLDER_MIME_TYPE,
  PARENT_CLAUSE_BATCH_SIZE,
  SHORTCUT_MIME_TYPE,
  buildParentsClause,
  chunk,
  effectiveMimeType,
  joinRelativePath,
  listDriveFiles,
  mapInWaves,
  quoteDriveLiteral,
  toMountedEntryName,
  type DriveItem,
  type DriveRequestContext
} from "./google-drive-folder-query.js";

// Drive has no "descendant of" query, so a subtree is expanded into folder IDs level by
// level with folder-only list calls. The result is cached briefly so repeat searches skip it.
const MAX_SUBTREE_FOLDERS = 1000;
const FOLDER_LIST_PAGE_SIZE = 1000;
const SUBTREE_CACHE_TTL_MS = 2 * 60 * 1000;
const SUBTREE_CACHE_MAX_ENTRIES = 200;

export interface GoogleDriveSubtreeFolders {
  // Folder ID -> path relative to the searched folder ("" for the folder itself).
  folderPaths: Map<string, string>;
  limitReached: boolean;
}

const subtreeCache = new Map<string, { expiresAt: number; value: Promise<GoogleDriveSubtreeFolders> }>();

async function resolveSubfolderId(context: DriveRequestContext, rootFolderId: string, subfolder: string | null): Promise<string> {
  const segments = (subfolder ?? "").split("/").map((segment) => segment.trim()).filter(Boolean);
  let folderId = rootFolderId;
  for (const segment of segments) {
    const name = segment.replace(/／/g, "/");
    const page = await listDriveFiles(context, {
      q: `trashed = false and mimeType = '${FOLDER_MIME_TYPE}' and name = ${quoteDriveLiteral(name)} and ${quoteDriveLiteral(folderId)} in parents`,
      fields: "id,name",
      pageSize: 1,
      orderBy: null,
      pageToken: null
    });
    const match = page.files[0]?.id;
    if (!match) {
      throw new SourceFileLinkActionError(`Folder not found in Google Drive: ${segments.join("/")}`);
    }
    folderId = match;
  }
  return folderId;
}

async function listChildFolders(context: DriveRequestContext, parentIds: string[]): Promise<DriveItem[]> {
  const children: DriveItem[] = [];
  let pageToken: string | null = null;
  do {
    const page = await listDriveFiles(context, {
      q: `trashed = false and (mimeType = '${FOLDER_MIME_TYPE}' or mimeType = '${SHORTCUT_MIME_TYPE}') and ${buildParentsClause(parentIds)}`,
      fields: "id,name,mimeType,parents,shortcutDetails",
      pageSize: FOLDER_LIST_PAGE_SIZE,
      orderBy: null,
      pageToken
    });
    children.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return children;
}

// depth 1 is the folder alone, 2 adds its direct subfolders, and 0 means no limit.
async function walkSubtreeFolders(context: DriveRequestContext, startFolderId: string, depth: number): Promise<GoogleDriveSubtreeFolders> {
  const folderPaths = new Map<string, string>([[startFolderId, ""]]);
  let level = [startFolderId];
  for (let levelDepth = 1; level.length > 0 && (depth === 0 || levelDepth < depth); levelDepth += 1) {
    const levelIds = new Set(level);
    const children = (await mapInWaves(chunk(level, PARENT_CLAUSE_BATCH_SIZE), (batch) => listChildFolders(context, batch))).flat();
    const nextLevel: string[] = [];
    for (const child of children) {
      const folderId = child.mimeType === SHORTCUT_MIME_TYPE ? child.shortcutDetails?.targetId : child.id;
      const parentId = child.parents?.find((id) => levelIds.has(id));
      if (!folderId || parentId === undefined || effectiveMimeType(child) !== FOLDER_MIME_TYPE || folderPaths.has(folderId)) {
        continue;
      }
      if (folderPaths.size >= MAX_SUBTREE_FOLDERS) {
        return { folderPaths, limitReached: true };
      }
      folderPaths.set(folderId, joinRelativePath(folderPaths.get(parentId) ?? "", toMountedEntryName(child)));
      nextLevel.push(folderId);
    }
    level = nextLevel;
  }
  return { folderPaths, limitReached: false };
}

function rememberSubtree(key: string, value: Promise<GoogleDriveSubtreeFolders>): void {
  const now = Date.now();
  for (const [cachedKey, entry] of subtreeCache) {
    if (entry.expiresAt <= now) subtreeCache.delete(cachedKey);
  }
  while (subtreeCache.size >= SUBTREE_CACHE_MAX_ENTRIES) {
    const oldestKey = subtreeCache.keys().next().value;
    if (oldestKey === undefined) break;
    subtreeCache.delete(oldestKey);
  }
  subtreeCache.set(key, { expiresAt: now + SUBTREE_CACHE_TTL_MS, value });
  value.catch(() => {
    if (subtreeCache.get(key)?.value === value) subtreeCache.delete(key);
  });
}

export async function getGoogleDriveSubtreeFolders(context: DriveRequestContext, input: {
  cacheScope: string;
  rootFolderId: string;
  subfolder: string | null;
  depth: number;
}): Promise<GoogleDriveSubtreeFolders> {
  const key = JSON.stringify([input.cacheScope, input.rootFolderId, input.subfolder ?? "", input.depth]);
  const cached = subtreeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const value = resolveSubfolderId(context, input.rootFolderId, input.subfolder)
    .then((startFolderId) => walkSubtreeFolders(context, startFolderId, input.depth));
  rememberSubtree(key, value);
  return value;
}

export function clearGoogleDriveSubtreeFolderCache(): void {
  subtreeCache.clear();
}
