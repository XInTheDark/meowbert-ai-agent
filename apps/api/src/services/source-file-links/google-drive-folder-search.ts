import type {
  LiveSyncFolderSearchFileType,
  LiveSyncFolderSearchMatch,
  LiveSyncFolderSearchOrder
} from "@meowbert/shared/live-sync-folder-search";
import { buildSourceBearerHeaders } from "../sources/provider-http.js";
import { SourceFileLinkActionError } from "./provider-errors.js";
import { isPlainObject } from "./remote-http-utils.js";
import {
  buildGoogleDriveResourceKeyHeader,
  decodeGoogleDriveItemReference,
  fetchGoogleDriveWithRetry,
  throwGoogleDriveHttpError
} from "./google-drive-remote.js";

// Drive has no "descendant of" query, so the subtree is expanded into folder IDs with
// folder-only list calls, then searched with batched `'<id>' in parents` clauses.
const GOOGLE_DRIVE_API_BASE_URL = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut";
const GOOGLE_APPS_MIME_PREFIX = "application/vnd.google-apps.";
const PARENT_CLAUSE_BATCH_SIZE = 40;
const MAX_SEARCHED_FOLDERS = 1000;
const FOLDER_LIST_PAGE_SIZE = 1000;
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

interface DriveItem {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
}

interface DriveListPage {
  files: DriveItem[];
  nextPageToken: string | null;
  incompleteSearch: boolean;
}

interface DriveRequestContext {
  accessToken: string;
  headers: Record<string, string>;
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

function quoteDriveLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function buildParentsClause(folderIds: string[]): string {
  return `(${folderIds.map((id) => `${quoteDriveLiteral(id)} in parents`).join(" or ")})`;
}

function buildTextClause(query: string, match: LiveSyncFolderSearchMatch): string {
  if (match === "exact_name") return `name = ${quoteDriveLiteral(query)}`;
  if (match === "name") return `name contains ${quoteDriveLiteral(query)}`;
  return `fullText contains ${quoteDriveLiteral(query)}`;
}

function buildGoogleDriveFolderSearchClauses(filters: GoogleDriveFolderSearchFilters): string[] {
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

async function listDriveFiles(context: DriveRequestContext, input: {
  q: string;
  fields: string;
  pageSize: number;
  orderBy: string | null;
  pageToken: string | null;
}): Promise<DriveListPage> {
  const url = new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files`);
  url.searchParams.set("q", input.q);
  url.searchParams.set("fields", `nextPageToken,incompleteSearch,files(${input.fields})`);
  url.searchParams.set("pageSize", String(input.pageSize));
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("corpora", "allDrives");
  if (input.orderBy) url.searchParams.set("orderBy", input.orderBy);
  if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);

  const { response, payload } = await fetchGoogleDriveWithRetry({
    execute: () => fetch(url, { headers: buildSourceBearerHeaders(context.accessToken, context.headers) }),
    maxAttempts: 3
  });
  if (!response.ok) {
    throwGoogleDriveHttpError("Google Drive folder search failed", payload, response.status);
  }
  if (!isPlainObject(payload) || !Array.isArray(payload.files)) {
    throw new Error("Google Drive folder search returned an invalid response.");
  }
  return {
    files: payload.files as DriveItem[],
    nextPageToken: typeof payload.nextPageToken === "string" && payload.nextPageToken ? payload.nextPageToken : null,
    incompleteSearch: payload.incompleteSearch === true
  };
}

function effectiveMimeType(item: DriveItem): string | null {
  return item.mimeType === SHORTCUT_MIME_TYPE
    ? item.shortcutDetails?.targetMimeType ?? null
    : item.mimeType ?? null;
}

// Mirrors how the rclone mount names entries: `/` is shown as a fullwidth slash and native
// Google files get the `.url` extension from `--drive-export-formats url`.
function toMountedEntryName(item: DriveItem): string {
  const name = (item.name ?? "untitled").replace(/\//g, "／");
  const mimeType = effectiveMimeType(item);
  const isNativeGoogleFile = mimeType?.startsWith(GOOGLE_APPS_MIME_PREFIX) === true && mimeType !== FOLDER_MIME_TYPE;
  return isNativeGoogleFile ? `${name}.url` : name;
}

function joinRelativePath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

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

async function collectGoogleDriveSubtreeFolders(context: DriveRequestContext, rootFolderId: string): Promise<{
  folderPaths: Map<string, string>;
  limitReached: boolean;
}> {
  const folderPaths = new Map<string, string>([[rootFolderId, ""]]);
  let pending = [rootFolderId];
  while (pending.length > 0 && folderPaths.size < MAX_SEARCHED_FOLDERS) {
    const batch = pending.slice(0, PARENT_CLAUSE_BATCH_SIZE);
    pending = pending.slice(PARENT_CLAUSE_BATCH_SIZE);
    for (const child of await listChildFolders(context, batch)) {
      const folderId = child.mimeType === SHORTCUT_MIME_TYPE ? child.shortcutDetails?.targetId : child.id;
      const parentId = child.parents?.find((id) => batch.includes(id));
      if (!folderId || parentId === undefined || effectiveMimeType(child) !== FOLDER_MIME_TYPE || folderPaths.has(folderId)) {
        continue;
      }
      if (folderPaths.size >= MAX_SEARCHED_FOLDERS) {
        return { folderPaths, limitReached: true };
      }
      folderPaths.set(folderId, joinRelativePath(folderPaths.get(parentId) ?? "", toMountedEntryName(child)));
      pending.push(folderId);
    }
  }
  return { folderPaths, limitReached: pending.length > 0 };
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
}): Promise<{ items: GoogleDriveFolderSearchItem[]; hasMore: boolean; incompleteSearch: boolean }> {
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

export async function searchGoogleDriveFolderSubtree(input: {
  accessToken: string;
  rootItemId: string;
  subfolder: string | null;
  filters: GoogleDriveFolderSearchFilters;
}): Promise<GoogleDriveFolderSearchResult> {
  const { filters } = input;
  if (filters.query && filters.match === "full_text" && filters.orderBy !== "relevance") {
    throw new SourceFileLinkActionError("Google Drive only sorts full-text results by relevance. Use order_by relevance, or match by name.");
  }
  const rootReference = decodeGoogleDriveItemReference(input.rootItemId);
  const context = { accessToken: input.accessToken, headers: buildGoogleDriveResourceKeyHeader(rootReference) };
  const startFolderId = await resolveSubfolderId(context, rootReference.itemId, input.subfolder);
  const { folderPaths, limitReached } = await collectGoogleDriveSubtreeFolders(context, startFolderId);

  const folderIds = [...folderPaths.keys()];
  const clauses = buildGoogleDriveFolderSearchClauses(filters);
  const orderBy = filters.orderBy === "relevance" ? null : DRIVE_ORDER_BY[filters.orderBy];
  let items: GoogleDriveFolderSearchItem[] = [];
  let hasMore = false;
  let incompleteSearch = false;
  for (let index = 0; index < folderIds.length; index += PARENT_CLAUSE_BATCH_SIZE) {
    if (!orderBy && items.length >= filters.limit) {
      hasMore = true;
      break;
    }
    const batch = await searchFolderBatch(context, {
      folderIds: folderIds.slice(index, index + PARENT_CLAUSE_BATCH_SIZE),
      folderPaths,
      clauses,
      orderBy,
      limit: orderBy ? filters.limit : filters.limit - items.length
    });
    items.push(...batch.items);
    hasMore ||= batch.hasMore;
    incompleteSearch ||= batch.incompleteSearch;
  }
  if (orderBy) {
    items.sort(compareSearchItems(filters.orderBy));
  }
  hasMore ||= items.length > filters.limit;
  items = items.slice(0, filters.limit);
  return { items, hasMore, searchedFolderCount: folderIds.length, folderLimitReached: limitReached, incompleteSearch };
}
