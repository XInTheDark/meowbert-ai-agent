import { setTimeout as delay } from "node:timers/promises";
import {
  LIVE_SYNC_FILE_VERSION_MAX_BYTES,
  type LiveSyncFileVersion,
  type LiveSyncFileVersionContent,
  type LiveSyncFileVersionList
} from "@meowbert/shared/live-sync-file-versions";
import { buildSourceBearerHeaders } from "../sources/provider-http.js";
import { getGoogleWorkspaceExport, isGoogleWorkspaceMimeType } from "../sources/google-drive-file-types.js";
import { fetchGoogleDriveWithRetry, throwGoogleDriveHttpError } from "./google-drive-remote.js";
import type { GoogleDriveFileReference } from "./google-drive-file-lookup.js";
import type { DriveRequestContext } from "./google-drive-folder-query.js";
import { KEPT_FOREVER_NOTE, isUnpinnedDownloadRefusal, markRevisionKeepForever } from "./google-drive-revision-pin.js";
import { SourceFileLinkActionError, SourceFileLinkProviderError } from "./provider-errors.js";
import { isPlainObject, parseResponsePayload } from "./remote-http-utils.js";

const GOOGLE_DRIVE_API_BASE_URL = "https://www.googleapis.com/drive/v3";
const REVISION_LIST_PAGE_SIZE = 1000;
const REVISION_LIST_MAX_PAGES = 5;
const DOWNLOAD_OPERATION_POLL_MS = 1_000;
const DOWNLOAD_OPERATION_TIMEOUT_MS = 90_000;

interface DriveRevision {
  id?: string;
  mimeType?: string;
  modifiedTime?: string;
  size?: string;
  keepForever?: boolean;
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
  exportLinks?: Record<string, string>;
}

function revisionUrl(fileId: string, revisionId?: string): URL {
  const base = `${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(fileId)}/revisions`;
  return new URL(revisionId ? `${base}/${encodeURIComponent(revisionId)}` : base);
}

async function getDriveJson(context: DriveRequestContext, url: URL, errorPrefix: string, missingMessage: string): Promise<Record<string, unknown>> {
  const { response, payload } = await fetchGoogleDriveWithRetry({
    execute: () => fetch(url, { headers: buildSourceBearerHeaders(context.accessToken, context.headers) }),
    maxAttempts: 3
  });
  if (response.status === 404) throw new SourceFileLinkActionError(missingMessage);
  if (!response.ok) throwGoogleDriveHttpError(errorPrefix, payload, response.status);
  if (!isPlainObject(payload)) throw new Error(`${errorPrefix}: Google Drive returned an invalid response.`);
  return payload;
}

function parseSize(value: string | undefined): number | null {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function toVersion(revision: DriveRevision, current: boolean): LiveSyncFileVersion | null {
  if (!revision.id) return null;
  const user = revision.lastModifyingUser;
  return {
    id: revision.id,
    modifiedAt: revision.modifiedTime ?? null,
    modifiedBy: user?.displayName || user?.emailAddress || null,
    sizeBytes: parseSize(revision.size),
    keepForever: revision.keepForever === true,
    current
  };
}

async function listAllRevisions(context: DriveRequestContext, fileId: string): Promise<{ revisions: DriveRevision[]; truncated: boolean }> {
  const revisions: DriveRevision[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < REVISION_LIST_MAX_PAGES; page += 1) {
    const url = revisionUrl(fileId);
    url.searchParams.set("pageSize", String(REVISION_LIST_PAGE_SIZE));
    url.searchParams.set("fields", "nextPageToken,revisions(id,modifiedTime,size,keepForever,lastModifyingUser(displayName,emailAddress))");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const payload = await getDriveJson(context, url, "Google Drive version history failed", "The file no longer exists in Google Drive.");
    revisions.push(...(Array.isArray(payload.revisions) ? payload.revisions as DriveRevision[] : []));
    pageToken = typeof payload.nextPageToken === "string" && payload.nextPageToken ? payload.nextPageToken : null;
    if (!pageToken) return { revisions, truncated: false };
  }
  return { revisions, truncated: true };
}

// Drive lists revisions oldest first; the last one is the file's current content.
export async function listGoogleDriveFileRevisions(context: DriveRequestContext, input: {
  file: GoogleDriveFileReference;
  limit: number;
  modifiedBefore: string | null;
}): Promise<LiveSyncFileVersionList> {
  const { revisions, truncated } = await listAllRevisions(context, input.file.fileId);
  const all = revisions
    .map((revision, index) => toVersion(revision, index === revisions.length - 1 && !truncated))
    .filter((version): version is LiveSyncFileVersion => version !== null)
    .reverse();
  const before = input.modifiedBefore ? Date.parse(input.modifiedBefore) : null;
  const eligible = before === null ? all : all.filter((version) => version.modifiedAt !== null && Date.parse(version.modifiedAt) < before);
  return {
    fileName: input.file.name,
    mimeType: input.file.mimeType,
    versions: eligible.slice(0, input.limit),
    totalVersions: all.length,
    hasOlder: eligible.length > input.limit || truncated,
    mayOmitOlderVersions: isGoogleWorkspaceMimeType(input.file.mimeType)
  };
}

export async function readCappedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = parseSize(response.headers.get("content-length") ?? undefined);
  if (declared !== null && declared > maxBytes) throw tooLargeError();
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLargeError();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function tooLargeError(): SourceFileLinkActionError {
  return new SourceFileLinkActionError(`That version is larger than ${LIVE_SYNC_FILE_VERSION_MAX_BYTES / (1024 * 1024)} MB, so it can't be saved here. Open the file's version history in Google Drive instead.`);
}

async function fetchContent(context: DriveRequestContext, url: string, init: RequestInit = {}): Promise<Buffer> {
  const response = await fetch(url, { ...init, headers: buildSourceBearerHeaders(context.accessToken, context.headers) });
  if (!response.ok) {
    const payload = await parseResponsePayload(response);
    if (response.status === 404) throw new SourceFileLinkActionError("Google Drive no longer has that version. It may have been purged.");
    throwGoogleDriveHttpError("Google Drive version download failed", payload, response.status);
  }
  return readCappedBody(response, LIVE_SYNC_FILE_VERSION_MAX_BYTES);
}

// Export for Docs and Sheets revisions without an export link; it runs as a long-running operation.
async function downloadRevisionViaOperation(context: DriveRequestContext, input: { fileId: string; revisionId: string; mimeType: string }): Promise<Buffer> {
  const url = new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(input.fileId)}/download`);
  url.searchParams.set("revisionId", input.revisionId);
  url.searchParams.set("mimeType", input.mimeType);
  const { response, payload } = await fetchGoogleDriveWithRetry({
    execute: () => fetch(url, { method: "POST", headers: buildSourceBearerHeaders(context.accessToken, context.headers) }),
    maxAttempts: 3
  });
  if (!response.ok) throwGoogleDriveHttpError("Google Drive version export failed", payload, response.status);
  let operation = isPlainObject(payload) ? payload : {};
  const deadline = Date.now() + DOWNLOAD_OPERATION_TIMEOUT_MS;
  while (operation.done !== true) {
    if (Date.now() > deadline || typeof operation.name !== "string") {
      throw new SourceFileLinkProviderError("Google Drive took too long to export that version. Try again shortly.", { statusCode: 504, retryable: true });
    }
    await delay(DOWNLOAD_OPERATION_POLL_MS);
    const pollUrl = new URL(`${GOOGLE_DRIVE_API_BASE_URL}/operations/${encodeURIComponent(operation.name)}`);
    operation = await getDriveJson(context, pollUrl, "Google Drive version export failed", "Google Drive lost the export of that version.");
  }
  const result = isPlainObject(operation.response) ? operation.response : null;
  if (typeof result?.downloadUri !== "string") {
    const reason = isPlainObject(operation.error) && typeof operation.error.message === "string" ? operation.error.message : "no download link was returned";
    throw new SourceFileLinkProviderError(`Google Drive could not export that version: ${reason}`, { statusCode: 502 });
  }
  return fetchContent(context, result.downloadUri);
}

async function downloadWorkspaceRevision(context: DriveRequestContext, file: GoogleDriveFileReference, revision: DriveRevision): Promise<{ content: Buffer; fileName: string; mimeType: string }> {
  const exportConfig = getGoogleWorkspaceExport(file.mimeType);
  if (!exportConfig) {
    throw new SourceFileLinkActionError("Past versions of this kind of Google file can't be exported. Only Docs, Sheets and Slides are supported.");
  }
  const exportLink = revision.exportLinks?.[exportConfig.mimeType];
  const content = exportLink
    ? await fetchContent(context, exportLink)
    : await downloadRevisionViaOperation(context, { fileId: file.fileId, revisionId: revision.id ?? "", mimeType: exportConfig.mimeType });
  const fileName = file.name.endsWith(exportConfig.extension) ? file.name : `${file.name}${exportConfig.extension}`;
  return { content, fileName, mimeType: exportConfig.mimeType };
}

export async function downloadGoogleDriveFileRevision(context: DriveRequestContext, input: {
  file: GoogleDriveFileReference;
  versionId: string;
}): Promise<LiveSyncFileVersionContent> {
  const metadataUrl = revisionUrl(input.file.fileId, input.versionId);
  metadataUrl.searchParams.set("fields", "id,mimeType,modifiedTime,size,keepForever,exportLinks");
  const revision = await getDriveJson(context, metadataUrl, "Google Drive version lookup failed", "Google Drive has no version with that id for this file. It may have been purged.") as DriveRevision;

  const downloaded = isGoogleWorkspaceMimeType(input.file.mimeType)
    ? { ...await downloadWorkspaceRevision(context, input.file, revision), warning: null }
    : await downloadBinaryRevision(context, input.file, revision, input.versionId);

  return {
    versionId: input.versionId,
    fileName: downloaded.fileName,
    mimeType: downloaded.mimeType,
    modifiedAt: revision.modifiedTime ?? null,
    sizeBytes: downloaded.content.byteLength,
    contentBase64: downloaded.content.toString("base64"),
    warning: downloaded.warning
  };
}

// Tries the plain download first, so a version is only pinned when Google actually refuses it.
async function downloadBinaryRevision(
  context: DriveRequestContext,
  file: GoogleDriveFileReference,
  revision: DriveRevision,
  versionId: string
): Promise<{ content: Buffer; fileName: string; mimeType: string | null; warning: string | null }> {
  const size = parseSize(revision.size);
  if (size !== null && size > LIVE_SYNC_FILE_VERSION_MAX_BYTES) throw tooLargeError();
  const mediaUrl = revisionUrl(file.fileId, versionId);
  mediaUrl.searchParams.set("alt", "media");
  const download = () => fetchContent(context, mediaUrl.toString());
  const described = { fileName: file.name, mimeType: revision.mimeType ?? file.mimeType };

  try {
    return { ...described, content: await download(), warning: null };
  } catch (error) {
    if (revision.keepForever === true || !isUnpinnedDownloadRefusal(error)) throw error;
  }
  await markRevisionKeepForever(context, { fileId: file.fileId, revisionId: versionId });
  try {
    return { ...described, content: await download(), warning: KEPT_FOREVER_NOTE };
  } catch (error) {
    // The mark stays either way, so the caller has to hear about it even when the download fails.
    const message = error instanceof Error ? error.message : String(error);
    throw new SourceFileLinkActionError(`${message} Version ${versionId} was marked "Keep forever" in Google Drive to allow the download and stays marked.`);
  }
}
