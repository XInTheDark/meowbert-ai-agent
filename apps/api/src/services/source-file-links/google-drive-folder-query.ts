import { buildSourceBearerHeaders } from "../sources/provider-http.js";
import { isPlainObject } from "./remote-http-utils.js";
import { fetchGoogleDriveWithRetry, throwGoogleDriveHttpError } from "./google-drive-remote.js";

const GOOGLE_DRIVE_API_BASE_URL = "https://www.googleapis.com/drive/v3";
export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
export const SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut";
const GOOGLE_APPS_MIME_PREFIX = "application/vnd.google-apps.";
// Folder IDs per `'<id>' in parents or ...` clause, which keeps the query URL short.
export const PARENT_CLAUSE_BATCH_SIZE = 40;
// Drive requests run in waves of this size so large subtrees do not trip rate limits.
export const DRIVE_REQUEST_CONCURRENCY = 8;

export interface DriveItem {
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

export interface DriveListPage {
  files: DriveItem[];
  nextPageToken: string | null;
  incompleteSearch: boolean;
}

export interface DriveRequestContext {
  accessToken: string;
  headers: Record<string, string>;
}

export function quoteDriveLiteral(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function buildParentsClause(folderIds: string[]): string {
  return `(${folderIds.map((id) => `${quoteDriveLiteral(id)} in parents`).join(" or ")})`;
}

export function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function mapInWaves<T, R>(values: T[], run: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (const wave of chunk(values, DRIVE_REQUEST_CONCURRENCY)) {
    results.push(...await Promise.all(wave.map(run)));
  }
  return results;
}

export async function listDriveFiles(context: DriveRequestContext, input: {
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

export function effectiveMimeType(item: DriveItem): string | null {
  return item.mimeType === SHORTCUT_MIME_TYPE
    ? item.shortcutDetails?.targetMimeType ?? null
    : item.mimeType ?? null;
}

// Mirrors how the rclone mount names entries: `/` is shown as a fullwidth slash and native
// Google files get the `.url` extension from `--drive-export-formats url`.
export function toMountedEntryName(item: DriveItem): string {
  const name = (item.name ?? "untitled").replace(/\//g, "／");
  const mimeType = effectiveMimeType(item);
  const isNativeGoogleFile = mimeType?.startsWith(GOOGLE_APPS_MIME_PREFIX) === true && mimeType !== FOLDER_MIME_TYPE;
  return isNativeGoogleFile ? `${name}.url` : name;
}

export function joinRelativePath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}
