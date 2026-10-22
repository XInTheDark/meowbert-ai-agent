import type {
  LiveSyncFolderSearchFileType,
  LiveSyncFolderSearchMatch,
  LiveSyncFolderSearchOrder
} from "@meowbert/shared/live-sync-folder-search";
import { SourceFileLinkActionError } from "./provider-errors.js";
import { buildGoogleDriveResourceKeyHeader, decodeGoogleDriveItemReference } from "./google-drive-remote.js";
import {
  DRIVE_REQUEST_CONCURRENCY,
  FOLDER_MIME_TYPE,
  PARENT_CLAUSE_BATCH_SIZE,
  buildParentsClause,
  chunk,
  effectiveMimeType,
  joinRelativePath,
  listDriveFiles,
  quoteDriveLiteral,
  toMountedEntryName,
  type DriveItem,
  type DriveRequestContext
} from "./google-drive-folder-query.js";
import { getGoogleDriveSubtreeFolders } from "./google-drive-subtree-folders.js";

// The subtree's folders are searched with batched `'<id>' in parents` clauses, since Drive
// matches only direct parents.
const ITEM_FIELDS = "id,name,mimeType,size,modifiedTime,createdTime,webViewLink,parents,trashed,shortcutDetails";

export interface GoogleDriveFolderSearchFilters {
  query: string | null;
  match: LiveSyncFolderSearchMatch;
  fileTypes: LiveSyncFolderSearchFileType[];
  modifiedAfter: string | null;
  modifiedBefore: string | null;
  extraQuery: string | null;
  orderBy: LiveSyncFolderSearchOrder;
  limit: number;
}

export interface GoogleDriveFolderSearchItem {
  id: string;
  name: string;
  path: string;
  kind: "file" | "folder";
  mimeType: string | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  createdAt: string | null;
  webUrl: string | null;
}

export interface GoogleDriveFolderSearchResult {
  items: GoogleDriveFolderSearchItem[];
  hasMore: boolean;
  searchedFolderCount: number;
  folderLimitReached: boolean;
  incompleteSearch: boolean;
}

interface BatchSearchResult {
  items: GoogleDriveFolderSearchItem[];
  hasMore: boolean;
  incompleteSearch: boolean;
}

const FILE_TYPE_CLAUSES: Record<LiveSyncFolderSearchFileType, string> = {
  folder: `mimeType = '${FOLDER_MIME_TYPE}'`,
  document: "mimeType = 'application/vnd.google-apps.document'",
  spreadsheet: "mimeType = 'application/vnd.google-apps.spreadsheet'",
  presentation: "mimeType = 'application/vnd.google-apps.presentation'",
  form: "mimeType = 'application/vnd.google-apps.form'",
  drawing: "mimeType = 'application/vnd.google-apps.drawing'",
  pdf: "mimeType = 'application/pdf'",
  image: "mimeType contains 'image/'",
  video: "mimeType contains 'video/'",
  audio: "mimeType contains 'audio/'",
  text: "mimeType contains 'text/'"
};

const DRIVE_ORDER_BY: Record<Exclude<LiveSyncFolderSearchOrder, "relevance">, string> = {
  modified_desc: "modifiedTime desc",
  modified_asc: "modifiedTime",
  created_desc: "createdTime desc",
  name: "name_natural"
};

function buildTextClause(query: string, match: LiveSyncFolderSearchMatch): string {
  if (match === "exact_name") return `name = ${quoteDriveLiteral(query)}`;
  if (match === "name") return `name contains ${quoteDriveLiteral(query)}`;
  return `fullText contains ${quoteDriveLiteral(query)}`;
}

function buildSearchClauses(filters: GoogleDriveFolderSearchFilters): string[] {
  const clauses = ["trashed = false"];
  if (filters.query) clauses.push(buildTextClause(filters.query, filters.match));
  if (filters.fileTypes.length > 0) {
    clauses.push(`(${filters.fileTypes.map((type) => FILE_TYPE_CLAUSES[type]).join(" or ")})`);
  }
  if (filters.modifiedAfter) clauses.push(`modifiedTime > ${quoteDriveLiteral(filters.modifiedAfter)}`);
  if (filters.modifiedBefore) clauses.push(`modifiedTime < ${quoteDriveLiteral(filters.modifiedBefore)}`);
  if (filters.extraQuery) clauses.push(`(${filters.extraQuery})`);
  return clauses;
}

function parseSize(value: string | undefined): number | null {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function toSearchItem(item: DriveItem, folderPaths: Map<string, string>): GoogleDriveFolderSearchItem | null {
  const parentId = item.parents?.find((id) => folderPaths.has(id));
  // Results are re-checked against the subtree so a crafted extra query cannot widen the scope.
  if (!item.id || !item.name || parentId === undefined || item.trashed === true) {
    return null;
  }
  return {
    id: item.id,
    name: item.name,
    path: joinRelativePath(folderPaths.get(parentId) ?? "", toMountedEntryName(item)),
    kind: effectiveMimeType(item) === FOLDER_MIME_TYPE ? "folder" : "file",
    mimeType: item.mimeType ?? null,
    sizeBytes: parseSize(item.size),
    modifiedAt: item.modifiedTime ?? null,
    createdAt: item.createdTime ?? null,
    webUrl: item.webViewLink ?? null
  };
}

function compareSearchItems(order: LiveSyncFolderSearchOrder) {
  return (left: GoogleDriveFolderSearchItem, right: GoogleDriveFolderSearchItem): number => {
    if (order === "name") return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
    const field = order === "created_desc" ? "createdAt" : "modifiedAt";
    const difference = Date.parse(left[field] ?? "") - Date.parse(right[field] ?? "");
    const ascending = Number.isNaN(difference) ? 0 : difference;
    return order === "modified_asc" ? ascending : -ascending;
  };
}

async function searchFolderBatch(context: DriveRequestContext, input: {
  folderIds: string[];
  folderPaths: Map<string, string>;
  clauses: string[];
  orderBy: string | null;
  limit: number;
}): Promise<BatchSearchResult> {
  const items: GoogleDriveFolderSearchItem[] = [];
  let pageToken: string | null = null;
  let incompleteSearch = false;
  do {
    const page = await listDriveFiles(context, {
      q: [...input.clauses, buildParentsClause(input.folderIds)].join(" and "),
      fields: ITEM_FIELDS,
      pageSize: Math.min(Math.max(input.limit - items.length, 1), 1000),
      orderBy: input.orderBy,
      pageToken
    });
    incompleteSearch ||= page.incompleteSearch;
    items.push(...page.files.flatMap((file) => toSearchItem(file, input.folderPaths) ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && items.length < input.limit);
  return { items: items.slice(0, input.limit), hasMore: pageToken !== null || items.length > input.limit, incompleteSearch };
}

// Batches run in parallel waves. Relevance results keep batch order and stop once the limit
// is filled; ordered results need every batch, then are merged and sorted.
async function searchFolderBatches(context: DriveRequestContext, input: {
  folderPaths: Map<string, string>;
  clauses: string[];
  orderBy: string | null;
  limit: number;
}): Promise<BatchSearchResult> {
  const batches = chunk([...input.folderPaths.keys()], PARENT_CLAUSE_BATCH_SIZE);
  const merged: BatchSearchResult = { items: [], hasMore: false, incompleteSearch: false };
  for (let index = 0; index < batches.length; index += DRIVE_REQUEST_CONCURRENCY) {
    if (!input.orderBy && merged.items.length >= input.limit) {
      merged.hasMore = true;
      break;
    }
    const remaining = input.orderBy ? input.limit : input.limit - merged.items.length;
    const wave = await Promise.all(batches.slice(index, index + DRIVE_REQUEST_CONCURRENCY).map((folderIds) => searchFolderBatch(context, {
      folderIds,
      folderPaths: input.folderPaths,
      clauses: input.clauses,
      orderBy: input.orderBy,
      limit: remaining
    })));
    for (const batch of wave) {
      merged.items.push(...batch.items);
      merged.hasMore ||= batch.hasMore;
      merged.incompleteSearch ||= batch.incompleteSearch;
    }
  }
  return merged;
}

export async function searchGoogleDriveFolderSubtree(input: {
  accessToken: string;
  cacheScope: string;
  rootItemId: string;
  subfolder: string | null;
  depth: number;
  filters: GoogleDriveFolderSearchFilters;
}): Promise<GoogleDriveFolderSearchResult> {
  const { filters } = input;
  if (filters.query && filters.match === "full_text" && filters.orderBy !== "relevance") {
    throw new SourceFileLinkActionError("Google Drive only sorts full-text results by relevance. Use order_by relevance, or match by name.");
  }
  const rootReference = decodeGoogleDriveItemReference(input.rootItemId);
  const context = { accessToken: input.accessToken, headers: buildGoogleDriveResourceKeyHeader(rootReference) };
  const { folderPaths, limitReached } = await getGoogleDriveSubtreeFolders(context, {
    cacheScope: input.cacheScope,
    rootFolderId: rootReference.itemId,
    subfolder: input.subfolder,
    depth: input.depth
  });

  const orderBy = filters.orderBy === "relevance" ? null : DRIVE_ORDER_BY[filters.orderBy];
  const result = await searchFolderBatches(context, {
    folderPaths,
    clauses: buildSearchClauses(filters),
    orderBy,
    limit: filters.limit
  });
  if (orderBy) {
    result.items.sort(compareSearchItems(filters.orderBy));
  }
  return {
    items: result.items.slice(0, filters.limit),
    hasMore: result.hasMore || result.items.length > filters.limit,
    searchedFolderCount: folderPaths.size,
    folderLimitReached: limitReached,
    incompleteSearch: result.incompleteSearch
  };
}
