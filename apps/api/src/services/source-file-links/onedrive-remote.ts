import fsPromises from "node:fs/promises";
import { buildSourceBearerHeaders } from "../sources/provider-http.js";
import { resolveWorkspaceSourceAccess } from "../sources/source-access.js";
import { getSourceCatalogEntry } from "../sources/source-catalog.js";
import { sourceConnectionCanWrite } from "../sources/workspace-source-connections.js";
import type { SourceDownloadResult } from "../sources/source-types.js";
import type { SourceFileLinkRemoteSnapshot } from "./types.js";
import {
  SourceFileLinkProviderError,
  SourceFileLinkRemoteConflictError,
  SourceFileLinkRemoteLockedError,
  SourceFileLinkRemoteMissingError
} from "./provider-errors.js";
import {
  fetchRemoteWithRetry,
  isPlainObject,
  parseResponsePayload,
  readSourceErrorMessage,
  type RemoteFetchResult
} from "./remote-http-utils.js";

export {
  SourceFileLinkProviderError,
  SourceFileLinkRemoteConflictError,
  SourceFileLinkRemoteLockedError,
  SourceFileLinkRemoteMissingError
} from "./provider-errors.js";

const MICROSOFT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const UPLOAD_CHUNK_SIZE_BYTES = 327_680 * 16;
const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const ONE_DRIVE_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const ONE_DRIVE_UPLOAD_MAX_ATTEMPTS = 4;
const ONE_DRIVE_RETRY_BASE_DELAY_MS = 1_000;

interface OneDriveDriveItem {
  id?: string;
  name?: string;
  size?: number;
  lastModifiedDateTime?: string;
  webUrl?: string;
  eTag?: string;
  cTag?: string;
  file?: { mimeType?: string } | null;
  folder?: Record<string, unknown> | null;
}

interface OneDriveUploadSession {
  uploadUrl: string;
}

function isRetryableOneDriveStatus(status: number): boolean {
  return ONE_DRIVE_RETRYABLE_STATUS_CODES.has(status);
}

async function fetchOneDriveWithRetry(input: {
  execute: () => Promise<Response>;
  maxAttempts?: number;
}): Promise<RemoteFetchResult> {
  return fetchRemoteWithRetry({
    execute: input.execute,
    retryableStatusCodes: ONE_DRIVE_RETRYABLE_STATUS_CODES,
    baseDelayMs: ONE_DRIVE_RETRY_BASE_DELAY_MS,
    maxAttempts: input.maxAttempts ?? ONE_DRIVE_UPLOAD_MAX_ATTEMPTS,
    unexpectedExitMessage: "OneDrive request retry loop exited unexpectedly."
  });
}

function requireOneDriveSource(sourceId: string): void {
  const source = getSourceCatalogEntry(sourceId);
  if (!source || source.provider !== "onedrive") {
    throw new Error("Live sync is currently only supported for OneDrive file sources.");
  }
}

async function resolveOneDriveAccess(input: {
  workspaceId: string;
  sourceId: string;
  requireWriteAccess?: boolean;
}) {
  requireOneDriveSource(input.sourceId);
  const access = await resolveWorkspaceSourceAccess({
    workspaceId: input.workspaceId,
    provider: "onedrive"
  });

  if (input.requireWriteAccess === true && !sourceConnectionCanWrite(access.connection)) {
    throw new Error("Reconnect the workspace OneDrive source to grant write access before using live sync.");
  }

  return access;
}

function mapRemoteSnapshot(item: OneDriveDriveItem): SourceFileLinkRemoteSnapshot {
  if (typeof item.id !== "string" || item.id.length === 0 || typeof item.name !== "string" || item.name.length === 0) {
    throw new Error("OneDrive did not return valid file metadata.");
  }

  return {
    itemId: item.id,
    kind: item.folder ? "folder" : "file",
    name: item.name,
    mimeType: item.file?.mimeType ?? null,
    webUrl: item.webUrl ?? null,
    modifiedAt: item.lastModifiedDateTime ?? null,
    sizeBytes: typeof item.size === "number" ? item.size : null,
    eTag: item.eTag ?? null,
    cTag: item.cTag ?? null
  };
}

function encodeOneDrivePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, " ");
}

function throwOneDriveHttpError(prefix: string, payload: unknown, status: number): never {
  const message = readSourceErrorMessage(payload, status);

  if (status === 404) {
    throw new SourceFileLinkRemoteMissingError("The remote OneDrive file no longer exists.");
  }
  if (status === 409 || status === 412) {
    throw new SourceFileLinkRemoteConflictError("The remote OneDrive file changed since the last sync.");
  }
  if (status === 423) {
    throw new SourceFileLinkRemoteLockedError(
      message.toLowerCase().includes("locked")
        ? message
        : "The remote OneDrive file is locked. Close it in OneDrive or Office and try again."
    );
  }
  if (status === 429) {
    throw new SourceFileLinkProviderError(
      `${prefix}: OneDrive temporarily throttled this request. Please retry in a moment.`,
      {
        statusCode: 503,
        upstreamStatus: status,
        retryable: true
      }
    );
  }

  throw new SourceFileLinkProviderError(
    `${prefix}: ${message}`,
    {
      statusCode: status >= 400 && status < 500
        ? status
        : (isRetryableOneDriveStatus(status) ? 502 : 500),
      upstreamStatus: status,
      retryable: isRetryableOneDriveStatus(status)
    }
  );
}

export async function fetchOneDriveRemoteSnapshot(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
  requireWriteAccess?: boolean;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const access = await resolveOneDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: input.requireWriteAccess
  });
  const url = new URL(`${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.itemId)}`);
  url.searchParams.set("$select", "id,name,size,lastModifiedDateTime,webUrl,eTag,cTag,file,folder");

  const response = await fetch(url, {
    headers: buildSourceBearerHeaders(access.accessToken)
  });
  const payload = await parseResponsePayload(response);

  if (response.status === 404) {
    throw new SourceFileLinkRemoteMissingError("The remote OneDrive file no longer exists.");
  }
  if (!response.ok) {
    throwOneDriveHttpError("OneDrive metadata request failed", payload, response.status);
  }
  if (!isPlainObject(payload)) {
    throw new Error("OneDrive metadata request returned an invalid response.");
  }

  return mapRemoteSnapshot(payload as OneDriveDriveItem);
}

async function cancelUploadSession(uploadUrl: string): Promise<void> {
  await fetch(uploadUrl, { method: "DELETE" }).catch(() => {});
}

async function createUploadSession(input: {
  workspaceId: string;
  sourceId: string;
  itemId?: string;
  parentItemId?: string;
  name?: string;
  ifMatchEtag?: string | null;
}): Promise<OneDriveUploadSession> {
  const access = await resolveOneDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: true
  });

  const sessionUrl = input.itemId
    ? `${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.itemId)}/createUploadSession`
    : `${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.parentItemId ?? "")}:/${encodeOneDrivePathSegment(input.name ?? "upload.bin")}:/createUploadSession`;

  const { response, payload } = await fetchOneDriveWithRetry({
    execute: () => fetch(
      sessionUrl,
      {
        method: "POST",
        headers: {
          ...buildSourceBearerHeaders(access.accessToken, {
            "content-type": "application/json"
          }),
          ...(input.ifMatchEtag ? { "if-match": input.ifMatchEtag } : {})
        },
        body: JSON.stringify({
          item: {
            "@microsoft.graph.conflictBehavior": "replace"
          }
        })
      }
    )
  });

  if (!response.ok) {
    throwOneDriveHttpError("OneDrive upload session request failed", payload, response.status);
  }
  if (!isPlainObject(payload) || typeof payload.uploadUrl !== "string" || payload.uploadUrl.length === 0) {
    throw new Error("OneDrive upload session response did not include an upload URL.");
  }

  return {
    uploadUrl: payload.uploadUrl
  };
}

async function uploadOneDriveRemoteFileDirectly(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
  localFilePath: string;
  ifMatchEtag?: string | null;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const access = await resolveOneDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: true
  });
  const fileBuffer = await fsPromises.readFile(input.localFilePath);
  const { response, payload } = await fetchOneDriveWithRetry({
    execute: () => fetch(
      `${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.itemId)}/content`,
      {
        method: "PUT",
        headers: {
          ...buildSourceBearerHeaders(access.accessToken, {
            "content-type": "application/octet-stream"
          }),
          ...(input.ifMatchEtag ? { "if-match": input.ifMatchEtag } : {})
        },
        body: fileBuffer
      }
    ),
    maxAttempts: 1
  });

  if (!response.ok) {
    throwOneDriveHttpError("OneDrive upload failed", payload, response.status);
  }
  if (!isPlainObject(payload)) {
    throw new Error("OneDrive upload response did not include file metadata.");
  }

  return mapRemoteSnapshot(payload as OneDriveDriveItem);
}

async function uploadOneDriveRemoteFileViaSession(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
  localFilePath: string;
  ifMatchEtag?: string | null;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const fileStats = await fsPromises.stat(input.localFilePath);
  const uploadSession = await createUploadSession({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    itemId: input.itemId,
    ifMatchEtag: input.ifMatchEtag ?? null
  });
  const fileHandle = await fsPromises.open(input.localFilePath, "r");
  let finalPayload: unknown = null;

  try {
    let offset = 0;
    while (offset < fileStats.size) {
      const chunkLength = Math.min(UPLOAD_CHUNK_SIZE_BYTES, fileStats.size - offset);
      const buffer = Buffer.alloc(chunkLength);
      const { bytesRead } = await fileHandle.read(buffer, 0, chunkLength, offset);
      if (bytesRead <= 0) {
        throw new Error("Unexpected end of file while uploading to OneDrive.");
      }

      const chunk = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
      const endOffset = offset + chunk.length - 1;
      const { response, payload } = await fetchOneDriveWithRetry({
        execute: () => fetch(uploadSession.uploadUrl, {
          method: "PUT",
          headers: {
            "content-length": `${chunk.length}`,
            "content-range": `bytes ${offset}-${endOffset}/${fileStats.size}`
          },
          body: chunk
        })
      });

      if (!(response.status === 200 || response.status === 201 || response.status === 202)) {
        throwOneDriveHttpError("OneDrive upload failed", payload, response.status);
      }

      finalPayload = payload;
      offset = endOffset + 1;
    }
  } catch (error) {
    await cancelUploadSession(uploadSession.uploadUrl);
    throw error;
  } finally {
    await fileHandle.close();
  }

  if (!isPlainObject(finalPayload)) {
    throw new Error("OneDrive upload finished without returning file metadata.");
  }

  return mapRemoteSnapshot(finalPayload as OneDriveDriveItem);
}

async function uploadOneDriveRemoteFileToSession(input: {
  uploadSession: OneDriveUploadSession;
  localFilePath: string;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const fileStats = await fsPromises.stat(input.localFilePath);
  const fileHandle = await fsPromises.open(input.localFilePath, "r");
  let finalPayload: unknown = null;

  try {
    let offset = 0;
    while (offset < fileStats.size) {
      const chunkLength = Math.min(UPLOAD_CHUNK_SIZE_BYTES, fileStats.size - offset);
      const buffer = Buffer.alloc(chunkLength);
      const { bytesRead } = await fileHandle.read(buffer, 0, chunkLength, offset);
      if (bytesRead <= 0) {
        throw new Error("Unexpected end of file while uploading to OneDrive.");
      }

      const chunk = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
      const endOffset = offset + chunk.length - 1;
      const { response, payload } = await fetchOneDriveWithRetry({
        execute: () => fetch(input.uploadSession.uploadUrl, {
          method: "PUT",
          headers: {
            "content-length": `${chunk.length}`,
            "content-range": `bytes ${offset}-${endOffset}/${fileStats.size}`
          },
          body: chunk
        })
      });

      if (!(response.status === 200 || response.status === 201 || response.status === 202)) {
        throwOneDriveHttpError("OneDrive upload failed", payload, response.status);
      }

      finalPayload = payload;
      offset = endOffset + 1;
    }
  } catch (error) {
    await cancelUploadSession(input.uploadSession.uploadUrl);
    throw error;
  } finally {
    await fileHandle.close();
  }

  if (!isPlainObject(finalPayload)) {
    throw new Error("OneDrive upload finished without returning file metadata.");
  }

  return mapRemoteSnapshot(finalPayload as OneDriveDriveItem);
}

export async function uploadOneDriveRemoteFile(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
  localFilePath: string;
  ifMatchEtag?: string | null;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const fileStats = await fsPromises.stat(input.localFilePath);
  if (!fileStats.isFile()) {
    throw new Error("Local live sync path is not a file.");
  }

  if (fileStats.size <= DIRECT_UPLOAD_MAX_BYTES) {
    try {
      return await uploadOneDriveRemoteFileDirectly(input);
    } catch (error) {
      if (
        error instanceof SourceFileLinkProviderError
        && error.retryable
        && error.upstreamStatus !== null
        && error.upstreamStatus >= 500
      ) {
        return uploadOneDriveRemoteFileViaSession(input);
      }

      throw error;
    }
  }

  return uploadOneDriveRemoteFileViaSession(input);
}

export async function listOneDriveRemoteFolderChildren(input: {
  workspaceId: string;
  sourceId: string;
  folderItemId: string;
}): Promise<SourceFileLinkRemoteSnapshot[]> {
  const access = await resolveOneDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });
  const url = new URL(`${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.folderItemId)}/children`);
  url.searchParams.set("$top", "200");
  url.searchParams.set("$select", "id,name,size,lastModifiedDateTime,webUrl,eTag,cTag,file,folder");
  const items: SourceFileLinkRemoteSnapshot[] = [];
  let nextUrl: string | null = url.toString();

  while (nextUrl) {
    const payload = await fetchOneDriveWithRetry({
      execute: () => fetch(nextUrl!, { headers: buildSourceBearerHeaders(access.accessToken) })
    });
    if (!payload.response.ok) {
      throwOneDriveHttpError("OneDrive folder browse failed", payload.payload, payload.response.status);
    }
    if (!isPlainObject(payload.payload) || !Array.isArray(payload.payload.value)) {
      throw new Error("OneDrive folder browse response did not include children.");
    }

    items.push(...payload.payload.value.map((item) => mapRemoteSnapshot(item as OneDriveDriveItem)));
    const nextLink = payload.payload["@odata.nextLink"];
    nextUrl = typeof nextLink === "string" && nextLink.length > 0 ? nextLink : null;
  }

  return items;
}

export async function downloadOneDriveRemoteFile(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
}): Promise<SourceDownloadResult> {
  const access = await resolveOneDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });
  const metadata = await fetchOneDriveRemoteSnapshot({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    itemId: input.itemId
  });
  if (metadata.kind !== "file") {
    throw new Error("OneDrive folders cannot be downloaded as files.");
  }

  const response = await fetch(`${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.itemId)}/content`, {
    headers: buildSourceBearerHeaders(access.accessToken)
  });
  if (!response.ok) {
    const payload = await parseResponsePayload(response);
    throwOneDriveHttpError("OneDrive download failed", payload, response.status);
  }

  return {
    fileName: metadata.name,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    modifiedAt: metadata.modifiedAt,
    response
  };
}

export async function createOneDriveRemoteFolder(input: {
  workspaceId: string;
  sourceId: string;
  parentItemId: string;
  name: string;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const access = await resolveOneDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: true
  });
  const { response, payload } = await fetchOneDriveWithRetry({
    execute: () => fetch(`${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.parentItemId)}/children`, {
      method: "POST",
      headers: buildSourceBearerHeaders(access.accessToken, { "content-type": "application/json" }),
      body: JSON.stringify({
        name: input.name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail"
      })
    })
  });

  if (!response.ok) {
    throwOneDriveHttpError("OneDrive folder create failed", payload, response.status);
  }
  if (!isPlainObject(payload)) {
    throw new Error("OneDrive folder create response did not include metadata.");
  }

  return mapRemoteSnapshot(payload as OneDriveDriveItem);
}

export async function uploadNewOneDriveRemoteFile(input: {
  workspaceId: string;
  sourceId: string;
  parentItemId: string;
  localFilePath: string;
  name: string;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const fileStats = await fsPromises.stat(input.localFilePath);
  const access = await resolveOneDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: true
  });

  if (fileStats.size <= DIRECT_UPLOAD_MAX_BYTES) {
    const fileBuffer = await fsPromises.readFile(input.localFilePath);
    const { response, payload } = await fetchOneDriveWithRetry({
      execute: () => fetch(
        `${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.parentItemId)}:/${encodeOneDrivePathSegment(input.name)}:/content`,
        {
          method: "PUT",
          headers: buildSourceBearerHeaders(access.accessToken, { "content-type": "application/octet-stream" }),
          body: fileBuffer
        }
      ),
      maxAttempts: 1
    });

    if (!response.ok) {
      throwOneDriveHttpError("OneDrive upload failed", payload, response.status);
    }
    if (!isPlainObject(payload)) {
      throw new Error("OneDrive upload response did not include file metadata.");
    }
    return mapRemoteSnapshot(payload as OneDriveDriveItem);
  }

  const uploadSession = await createUploadSession({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    parentItemId: input.parentItemId,
    name: input.name
  });
  return uploadOneDriveRemoteFileToSession({
    uploadSession,
    localFilePath: input.localFilePath
  });
}

export async function deleteOneDriveRemoteItem(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
}): Promise<void> {
  const access = await resolveOneDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: true
  });
  const { response, payload } = await fetchOneDriveWithRetry({
    execute: () => fetch(`${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.itemId)}`, {
      method: "DELETE",
      headers: buildSourceBearerHeaders(access.accessToken)
    })
  });

  if (!(response.ok || response.status === 204 || response.status === 404)) {
    throwOneDriveHttpError("OneDrive delete failed", payload, response.status);
  }
}
