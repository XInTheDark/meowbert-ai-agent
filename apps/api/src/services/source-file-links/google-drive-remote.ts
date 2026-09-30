import fsPromises from "node:fs/promises";
import path from "node:path";
import { buildSourceBearerHeaders } from "../sources/provider-http.js";
import { resolveWorkspaceSourceAccess } from "../sources/source-access.js";
import { getSourceCatalogEntry } from "../sources/source-catalog.js";
import {
  GOOGLE_WORKSPACE_IMPORT_MIME_BY_EXTENSION,
  getGoogleWorkspaceExport,
  isGoogleWorkspaceMimeType
} from "../sources/google-drive-file-types.js";
import { sourceConnectionCanWrite } from "../sources/workspace-source-connections.js";
import type { SourceDownloadResult } from "../sources/source-types.js";
import type { SourceFileLinkRemoteSnapshot } from "./types.js";
import {
  SourceFileLinkProviderError,
  SourceFileLinkRemoteConflictError,
  SourceFileLinkRemoteMissingError
} from "./provider-errors.js";
import {
  fetchRemoteWithRetry,
  isPlainObject,
  parseResponsePayload,
  readSourceErrorMessage,
  type RemoteFetchResult
} from "./remote-http-utils.js";

const GOOGLE_DRIVE_API_BASE_URL = "https://www.googleapis.com/drive/v3";
const GOOGLE_DRIVE_UPLOAD_BASE_URL = "https://www.googleapis.com/upload/drive/v3";
const GOOGLE_DRIVE_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,md5Checksum,version,headRevisionId";
const GOOGLE_DRIVE_UPLOAD_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,md5Checksum,version,headRevisionId";
const GOOGLE_DRIVE_DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE_BYTES = 256 * 1024 * 16;
const GOOGLE_DRIVE_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const GOOGLE_DRIVE_UPLOAD_MAX_ATTEMPTS = 4;
const GOOGLE_DRIVE_RETRY_BASE_DELAY_MS = 1_000;
const GOOGLE_DRIVE_RESOURCE_KEY_SEPARATOR = "::resourceKey::";

interface GoogleDriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  md5Checksum?: string;
  version?: string;
  headRevisionId?: string;
}

interface GoogleDriveUploadSession {
  uploadUrl: string;
}

function decodeGoogleDriveItemReference(value: string): { itemId: string; resourceKey: string | null } {
  const [itemId, resourceKey] = value.split(GOOGLE_DRIVE_RESOURCE_KEY_SEPARATOR, 2);
  return {
    itemId: itemId ?? value,
    resourceKey: resourceKey?.trim() || null
  };
}

function buildGoogleDriveResourceKeyHeader(input: { itemId: string; resourceKey: string | null }): Record<string, string> {
  if (!input.resourceKey) {
    return {};
  }

  return {
    "x-goog-drive-resource-keys": `${input.itemId}/${input.resourceKey}`
  };
}

function isRetryableGoogleDriveStatus(status: number): boolean {
  return GOOGLE_DRIVE_RETRYABLE_STATUS_CODES.has(status);
}

async function fetchGoogleDriveWithRetry(input: {
  execute: () => Promise<Response>;
  maxAttempts?: number;
}): Promise<RemoteFetchResult> {
  return fetchRemoteWithRetry({
    execute: input.execute,
    retryableStatusCodes: GOOGLE_DRIVE_RETRYABLE_STATUS_CODES,
    baseDelayMs: GOOGLE_DRIVE_RETRY_BASE_DELAY_MS,
    maxAttempts: input.maxAttempts ?? GOOGLE_DRIVE_UPLOAD_MAX_ATTEMPTS,
    unexpectedExitMessage: "Google Drive request retry loop exited unexpectedly."
  });
}

function throwGoogleDriveHttpError(prefix: string, payload: unknown, status: number): never {
  const message = readSourceErrorMessage(payload, status);

  if (status === 404) {
    throw new SourceFileLinkRemoteMissingError("The remote Google Drive file no longer exists.");
  }
  if (status === 409 || status === 412) {
    throw new SourceFileLinkRemoteConflictError("The remote Google Drive file changed since the last sync.");
  }
  if (status === 429) {
    throw new SourceFileLinkProviderError(
      `${prefix}: Google Drive temporarily throttled this request. Please retry in a moment.`,
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
        : (isRetryableGoogleDriveStatus(status) ? 502 : 500),
      upstreamStatus: status,
      retryable: isRetryableGoogleDriveStatus(status)
    }
  );
}

function requireGoogleDriveSource(sourceId: string): void {
  const source = getSourceCatalogEntry(sourceId);
  if (!source || source.provider !== "google-drive") {
    throw new Error("Google Drive live sync is only supported for Google Drive file sources.");
  }
}

async function resolveGoogleDriveAccess(input: {
  workspaceId: string;
  sourceId: string;
  requireWriteAccess?: boolean;
}) {
  requireGoogleDriveSource(input.sourceId);
  const access = await resolveWorkspaceSourceAccess({
    workspaceId: input.workspaceId,
    provider: "google-drive"
  });

  if (input.requireWriteAccess === true && !sourceConnectionCanWrite(access.connection)) {
    throw new SourceFileLinkProviderError(
      "Reconnect the workspace Google Drive source to grant write access before using live sync.",
      {
        statusCode: 409
      }
    );
  }

  return access;
}

function parseGoogleDriveSize(value: string | undefined): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapRemoteSnapshot(item: GoogleDriveFile, responseEtag: string | null, itemReferenceId?: string): SourceFileLinkRemoteSnapshot {
  if (typeof item.id !== "string" || item.id.length === 0 || typeof item.name !== "string" || item.name.length === 0) {
    throw new Error("Google Drive did not return valid file metadata.");
  }

  return {
    itemId: itemReferenceId ?? item.id,
    kind: item.mimeType === "application/vnd.google-apps.folder" ? "folder" : "file",
    name: item.name,
    mimeType: item.mimeType ?? null,
    webUrl: item.webViewLink ?? null,
    modifiedAt: item.modifiedTime ?? null,
    sizeBytes: parseGoogleDriveSize(item.size),
    eTag: responseEtag,
    cTag: item.headRevisionId ?? item.md5Checksum ?? (item.version ? `version:${item.version}` : null)
  };
}

function getGoogleDriveLocalName(item: GoogleDriveFile): string {
  const exportConfig = getGoogleWorkspaceExport(item.mimeType);
  if (!exportConfig || typeof item.name !== "string") {
    return item.name ?? "untitled";
  }
  return item.name.endsWith(exportConfig.extension) ? item.name : `${item.name}${exportConfig.extension}`;
}

async function fetchGoogleDriveFileMetadata(input: {
  accessToken: string;
  itemId: string;
}): Promise<{ snapshot: SourceFileLinkRemoteSnapshot; mimeType: string | null }> {
  const itemReference = decodeGoogleDriveItemReference(input.itemId);
  const url = new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(itemReference.itemId)}`);
  url.searchParams.set("fields", GOOGLE_DRIVE_FIELDS);
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    headers: buildSourceBearerHeaders(input.accessToken, buildGoogleDriveResourceKeyHeader(itemReference))
  });
  const payload = await parseResponsePayload(response);

  if (response.status === 404) {
    throw new SourceFileLinkRemoteMissingError("The remote Google Drive file no longer exists.");
  }
  if (!response.ok) {
    throwGoogleDriveHttpError("Google Drive metadata request failed", payload, response.status);
  }
  if (!isPlainObject(payload)) {
    throw new Error("Google Drive metadata request returned an invalid response.");
  }

  const snapshot = mapRemoteSnapshot(payload as GoogleDriveFile, response.headers.get("etag"), input.itemId);
  return {
    snapshot,
    mimeType: typeof (payload as GoogleDriveFile).mimeType === "string" ? (payload as GoogleDriveFile).mimeType! : null
  };
}

export async function fetchGoogleDriveRemoteSnapshot(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
  requireWriteAccess?: boolean;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const access = await resolveGoogleDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: input.requireWriteAccess
  });

  return (await fetchGoogleDriveFileMetadata({
    accessToken: access.accessToken,
    itemId: input.itemId
  })).snapshot;
}

function inferGoogleDriveUploadContentType(input: {
  localFilePath: string;
  remoteMimeType: string | null;
}): string {
  const extension = path.extname(input.localFilePath).toLowerCase();
  const importMimeType = GOOGLE_WORKSPACE_IMPORT_MIME_BY_EXTENSION[extension];

  if (isGoogleWorkspaceMimeType(input.remoteMimeType)) {
    if (!importMimeType) {
      throw new Error("Google Workspace live sync can only push supported Office/OpenDocument/text formats back to native Google files.");
    }
    return importMimeType;
  }

  return input.remoteMimeType ?? importMimeType ?? "application/octet-stream";
}

function buildGoogleDriveUploadMetadata(remoteMimeType: string | null): Record<string, string> {
  if (isGoogleWorkspaceMimeType(remoteMimeType)) {
    return {
      mimeType: remoteMimeType!
    };
  }

  return {};
}

function buildMultipartUploadBody(input: {
  metadata: Record<string, unknown>;
  media: Buffer;
  mediaMimeType: string;
}): { body: Buffer; contentType: string } {
  const boundary = `meowbert-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const chunks = [
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(input.metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\ncontent-type: ${input.mediaMimeType}\r\n\r\n`),
    input.media,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ];

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/related; boundary=${boundary}`
  };
}

function buildUploadUrl(itemId: string, uploadType: "multipart" | "resumable"): string {
  const itemReference = decodeGoogleDriveItemReference(itemId);
  const url = new URL(`${GOOGLE_DRIVE_UPLOAD_BASE_URL}/files/${encodeURIComponent(itemReference.itemId)}`);
  url.searchParams.set("uploadType", uploadType);
  url.searchParams.set("fields", GOOGLE_DRIVE_UPLOAD_FIELDS);
  url.searchParams.set("supportsAllDrives", "true");
  return url.toString();
}

function buildCreateUploadUrl(uploadType: "multipart" | "resumable"): string {
  const url = new URL(`${GOOGLE_DRIVE_UPLOAD_BASE_URL}/files`);
  url.searchParams.set("uploadType", uploadType);
  url.searchParams.set("fields", GOOGLE_DRIVE_UPLOAD_FIELDS);
  url.searchParams.set("supportsAllDrives", "true");
  return url.toString();
}

function buildConditionalHeaders(ifMatchEtag: string | null | undefined): Record<string, string> {
  if (!ifMatchEtag || ifMatchEtag.startsWith("version:")) {
    return {};
  }

  return {
    "if-match": ifMatchEtag
  };
}

async function uploadGoogleDriveRemoteFileDirectly(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
  localFilePath: string;
  ifMatchEtag?: string | null;
  remoteMimeType: string | null;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const access = await resolveGoogleDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: true
  });
  const fileBuffer = await fsPromises.readFile(input.localFilePath);
  const mediaMimeType = inferGoogleDriveUploadContentType({
    localFilePath: input.localFilePath,
    remoteMimeType: input.remoteMimeType
  });
  const multipart = buildMultipartUploadBody({
    metadata: buildGoogleDriveUploadMetadata(input.remoteMimeType),
    media: fileBuffer,
    mediaMimeType
  });
  const { response, payload } = await fetchGoogleDriveWithRetry({
    execute: () => fetch(
      buildUploadUrl(input.itemId, "multipart"),
      {
        method: "PATCH",
        headers: {
          ...buildSourceBearerHeaders(access.accessToken, {
            "content-type": multipart.contentType
          }),
          ...buildGoogleDriveResourceKeyHeader(decodeGoogleDriveItemReference(input.itemId)),
          ...buildConditionalHeaders(input.ifMatchEtag)
        },
        body: multipart.body as unknown as BodyInit
      }
    ),
    maxAttempts: 1
  });

  if (!response.ok) {
    throwGoogleDriveHttpError("Google Drive upload failed", payload, response.status);
  }
  if (!isPlainObject(payload)) {
    throw new Error("Google Drive upload response did not include file metadata.");
  }

  return mapRemoteSnapshot(payload as GoogleDriveFile, response.headers.get("etag"));
}

async function createUploadSession(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
  localFilePath: string;
  ifMatchEtag?: string | null;
  remoteMimeType: string | null;
  fileSize: number;
}): Promise<GoogleDriveUploadSession> {
  const access = await resolveGoogleDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: true
  });
  const mediaMimeType = inferGoogleDriveUploadContentType({
    localFilePath: input.localFilePath,
    remoteMimeType: input.remoteMimeType
  });
  const { response, payload } = await fetchGoogleDriveWithRetry({
    execute: () => fetch(
      buildUploadUrl(input.itemId, "resumable"),
      {
        method: "PATCH",
        headers: {
          ...buildSourceBearerHeaders(access.accessToken, {
            "content-type": "application/json; charset=UTF-8",
            "x-upload-content-length": `${input.fileSize}`,
            "x-upload-content-type": mediaMimeType
          }),
          ...buildGoogleDriveResourceKeyHeader(decodeGoogleDriveItemReference(input.itemId)),
          ...buildConditionalHeaders(input.ifMatchEtag)
        },
        body: JSON.stringify(buildGoogleDriveUploadMetadata(input.remoteMimeType))
      }
    )
  });

  if (!response.ok) {
    throwGoogleDriveHttpError("Google Drive upload session request failed", payload, response.status);
  }

  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) {
    throw new Error("Google Drive upload session response did not include an upload URL.");
  }

  return { uploadUrl };
}

async function uploadGoogleDriveRemoteFileViaSession(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
  localFilePath: string;
  ifMatchEtag?: string | null;
  remoteMimeType: string | null;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const fileStats = await fsPromises.stat(input.localFilePath);
  const uploadSession = await createUploadSession({
    ...input,
    fileSize: fileStats.size
  });
  const fileHandle = await fsPromises.open(input.localFilePath, "r");
  let finalPayload: unknown = null;
  let finalEtag: string | null = null;

  try {
    let offset = 0;
    while (offset < fileStats.size) {
      const chunkLength = Math.min(GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE_BYTES, fileStats.size - offset);
      const buffer = Buffer.alloc(chunkLength);
      const { bytesRead } = await fileHandle.read(buffer, 0, chunkLength, offset);
      if (bytesRead <= 0) {
        throw new Error("Unexpected end of file while uploading to Google Drive.");
      }

      const chunk = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
      const endOffset = offset + chunk.length - 1;
      const { response, payload } = await fetchGoogleDriveWithRetry({
        execute: () => fetch(uploadSession.uploadUrl, {
          method: "PUT",
          headers: {
            "content-length": `${chunk.length}`,
            "content-range": `bytes ${offset}-${endOffset}/${fileStats.size}`
          },
          body: chunk as unknown as BodyInit
        })
      });

      if (response.status === 308) {
        offset = endOffset + 1;
        continue;
      }
      if (!(response.status === 200 || response.status === 201)) {
        throwGoogleDriveHttpError("Google Drive upload failed", payload, response.status);
      }

      finalPayload = payload;
      finalEtag = response.headers.get("etag");
      offset = endOffset + 1;
    }
  } finally {
    await fileHandle.close();
  }

  if (!isPlainObject(finalPayload)) {
    throw new Error("Google Drive upload finished without returning file metadata.");
  }

  return mapRemoteSnapshot(finalPayload as GoogleDriveFile, finalEtag);
}

export async function uploadGoogleDriveRemoteFile(input: {
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

  const access = await resolveGoogleDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: true
  });
  const remoteBefore = await fetchGoogleDriveFileMetadata({
    accessToken: access.accessToken,
    itemId: input.itemId
  });
  const uploadInput = {
    ...input,
    remoteMimeType: remoteBefore.mimeType
  };

  if (fileStats.size <= GOOGLE_DRIVE_DIRECT_UPLOAD_MAX_BYTES) {
    try {
      return await uploadGoogleDriveRemoteFileDirectly(uploadInput);
    } catch (error) {
      if (
        error instanceof SourceFileLinkProviderError
        && error.retryable
        && error.upstreamStatus !== null
        && error.upstreamStatus >= 500
      ) {
        return uploadGoogleDriveRemoteFileViaSession(uploadInput);
      }

      throw error;
    }
  }

  return uploadGoogleDriveRemoteFileViaSession(uploadInput);
}

export async function listGoogleDriveRemoteFolderChildren(input: {
  workspaceId: string;
  sourceId: string;
  folderItemId: string;
}): Promise<SourceFileLinkRemoteSnapshot[]> {
  const access = await resolveGoogleDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });
  const folderReference = decodeGoogleDriveItemReference(input.folderItemId);
  const url = new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files`);
  url.searchParams.set("pageSize", "200");
  url.searchParams.set("q", `trashed = false and '${folderReference.itemId.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' in parents`);
  url.searchParams.set("fields", `nextPageToken,files(${GOOGLE_DRIVE_FIELDS})`);
  url.searchParams.set("orderBy", "folder,name_natural");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  const items: SourceFileLinkRemoteSnapshot[] = [];
  let nextPageToken: string | null = null;

  do {
    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    } else {
      url.searchParams.delete("pageToken");
    }

    const { response, payload } = await fetchGoogleDriveWithRetry({
      execute: () => fetch(url, {
        headers: buildSourceBearerHeaders(access.accessToken, buildGoogleDriveResourceKeyHeader(folderReference))
      })
    });
    if (!response.ok) {
      throwGoogleDriveHttpError("Google Drive folder browse failed", payload, response.status);
    }
    if (!isPlainObject(payload) || !Array.isArray(payload.files)) {
      throw new Error("Google Drive folder browse response did not include children.");
    }

    items.push(...payload.files.map((item) => {
      const snapshot = mapRemoteSnapshot(item as GoogleDriveFile, null);
      return {
        ...snapshot,
        name: snapshot.kind === "file" ? getGoogleDriveLocalName(item as GoogleDriveFile) : snapshot.name
      };
    }));
    nextPageToken = typeof payload.nextPageToken === "string" && payload.nextPageToken.length > 0
      ? payload.nextPageToken
      : null;
  } while (nextPageToken);

  return items;
}

function resolveGoogleDriveDownload(input: SourceFileLinkRemoteSnapshot): { url: string; fileName: string; mimeType: string | null } {
  const itemReference = decodeGoogleDriveItemReference(input.itemId);
  const exportConfig = getGoogleWorkspaceExport(input.mimeType);
  if (exportConfig) {
    const exportUrl = new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(itemReference.itemId)}/export`);
    exportUrl.searchParams.set("mimeType", exportConfig.mimeType);
    return {
      url: exportUrl.toString(),
      fileName: input.name.endsWith(exportConfig.extension) ? input.name : `${input.name}${exportConfig.extension}`,
      mimeType: exportConfig.mimeType
    };
  }

  if (isGoogleWorkspaceMimeType(input.mimeType)) {
    throw new Error(`Google Drive file type is not supported for export: ${input.mimeType}`);
  }

  const downloadUrl = new URL(`${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(itemReference.itemId)}`);
  downloadUrl.searchParams.set("alt", "media");
  return {
    url: downloadUrl.toString(),
    fileName: input.name,
    mimeType: input.mimeType
  };
}

export async function downloadGoogleDriveRemoteFile(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
}): Promise<SourceDownloadResult> {
  const access = await resolveGoogleDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId
  });
  const metadata = await fetchGoogleDriveFileMetadata({
    accessToken: access.accessToken,
    itemId: input.itemId
  });
  if (metadata.snapshot.kind !== "file") {
    throw new Error("Google Drive folders cannot be downloaded as files.");
  }

  const resolvedDownload = resolveGoogleDriveDownload(metadata.snapshot);
  const itemReference = decodeGoogleDriveItemReference(input.itemId);
  const response = await fetch(resolvedDownload.url, {
    headers: buildSourceBearerHeaders(access.accessToken, buildGoogleDriveResourceKeyHeader(itemReference))
  });
  if (!response.ok) {
    const payload = await parseResponsePayload(response);
    throwGoogleDriveHttpError("Google Drive download failed", payload, response.status);
  }

  return {
    fileName: resolvedDownload.fileName,
    mimeType: resolvedDownload.mimeType,
    sizeBytes: metadata.snapshot.sizeBytes,
    modifiedAt: metadata.snapshot.modifiedAt,
    response
  };
}

export async function createGoogleDriveRemoteFolder(input: {
  workspaceId: string;
  sourceId: string;
  parentItemId: string;
  name: string;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const access = await resolveGoogleDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: true
  });
  const parentReference = decodeGoogleDriveItemReference(input.parentItemId);
  const { response, payload } = await fetchGoogleDriveWithRetry({
    execute: () => fetch(`${GOOGLE_DRIVE_API_BASE_URL}/files?fields=${encodeURIComponent(GOOGLE_DRIVE_FIELDS)}&supportsAllDrives=true`, {
      method: "POST",
      headers: buildSourceBearerHeaders(access.accessToken, {
        "content-type": "application/json; charset=UTF-8",
        ...buildGoogleDriveResourceKeyHeader(parentReference)
      }),
      body: JSON.stringify({
        name: input.name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentReference.itemId]
      })
    })
  });

  if (!response.ok) {
    throwGoogleDriveHttpError("Google Drive folder create failed", payload, response.status);
  }
  if (!isPlainObject(payload)) {
    throw new Error("Google Drive folder create response did not include metadata.");
  }

  return mapRemoteSnapshot(payload as GoogleDriveFile, response.headers.get("etag"));
}

async function createGoogleDriveFileUploadSession(input: {
  accessToken: string;
  parentItemId: string;
  name: string;
  localFilePath: string;
  fileSize: number;
}): Promise<GoogleDriveUploadSession> {
  const parentReference = decodeGoogleDriveItemReference(input.parentItemId);
  const mediaMimeType = inferGoogleDriveUploadContentType({
    localFilePath: input.localFilePath,
    remoteMimeType: null
  });
  const { response, payload } = await fetchGoogleDriveWithRetry({
    execute: () => fetch(buildCreateUploadUrl("resumable"), {
      method: "POST",
      headers: buildSourceBearerHeaders(input.accessToken, {
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": `${input.fileSize}`,
        "x-upload-content-type": mediaMimeType,
        ...buildGoogleDriveResourceKeyHeader(parentReference)
      }),
      body: JSON.stringify({
        name: input.name,
        parents: [parentReference.itemId]
      })
    })
  });

  if (!response.ok) {
    throwGoogleDriveHttpError("Google Drive upload session request failed", payload, response.status);
  }

  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) {
    throw new Error("Google Drive upload session response did not include an upload URL.");
  }

  return { uploadUrl };
}

async function uploadGoogleDriveNewFileViaSession(input: {
  uploadSession: GoogleDriveUploadSession;
  localFilePath: string;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const fileStats = await fsPromises.stat(input.localFilePath);
  const fileHandle = await fsPromises.open(input.localFilePath, "r");
  let finalPayload: unknown = null;
  let finalEtag: string | null = null;

  try {
    let offset = 0;
    while (offset < fileStats.size) {
      const chunkLength = Math.min(GOOGLE_DRIVE_UPLOAD_CHUNK_SIZE_BYTES, fileStats.size - offset);
      const buffer = Buffer.alloc(chunkLength);
      const { bytesRead } = await fileHandle.read(buffer, 0, chunkLength, offset);
      if (bytesRead <= 0) {
        throw new Error("Unexpected end of file while uploading to Google Drive.");
      }

      const chunk = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
      const endOffset = offset + chunk.length - 1;
      const { response, payload } = await fetchGoogleDriveWithRetry({
        execute: () => fetch(input.uploadSession.uploadUrl, {
          method: "PUT",
          headers: {
            "content-length": `${chunk.length}`,
            "content-range": `bytes ${offset}-${endOffset}/${fileStats.size}`
          },
          body: chunk as unknown as BodyInit
        })
      });

      if (response.status === 308) {
        offset = endOffset + 1;
        continue;
      }
      if (!(response.status === 200 || response.status === 201)) {
        throwGoogleDriveHttpError("Google Drive upload failed", payload, response.status);
      }

      finalPayload = payload;
      finalEtag = response.headers.get("etag");
      offset = endOffset + 1;
    }
  } finally {
    await fileHandle.close();
  }

  if (!isPlainObject(finalPayload)) {
    throw new Error("Google Drive upload finished without returning file metadata.");
  }

  return mapRemoteSnapshot(finalPayload as GoogleDriveFile, finalEtag);
}

export async function uploadNewGoogleDriveRemoteFile(input: {
  workspaceId: string;
  sourceId: string;
  parentItemId: string;
  localFilePath: string;
  name: string;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const fileStats = await fsPromises.stat(input.localFilePath);
  const access = await resolveGoogleDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: true
  });
  const parentReference = decodeGoogleDriveItemReference(input.parentItemId);

  if (fileStats.size <= GOOGLE_DRIVE_DIRECT_UPLOAD_MAX_BYTES) {
    const fileBuffer = await fsPromises.readFile(input.localFilePath);
    const mediaMimeType = inferGoogleDriveUploadContentType({
      localFilePath: input.localFilePath,
      remoteMimeType: null
    });
    const multipart = buildMultipartUploadBody({
      metadata: {
        name: input.name,
        parents: [parentReference.itemId]
      },
      media: fileBuffer,
      mediaMimeType
    });
    const { response, payload } = await fetchGoogleDriveWithRetry({
      execute: () => fetch(buildCreateUploadUrl("multipart"), {
        method: "POST",
        headers: buildSourceBearerHeaders(access.accessToken, {
          "content-type": multipart.contentType,
          ...buildGoogleDriveResourceKeyHeader(parentReference)
        }),
        body: multipart.body as unknown as BodyInit
      }),
      maxAttempts: 1
    });

    if (!response.ok) {
      throwGoogleDriveHttpError("Google Drive upload failed", payload, response.status);
    }
    if (!isPlainObject(payload)) {
      throw new Error("Google Drive upload response did not include file metadata.");
    }
    return mapRemoteSnapshot(payload as GoogleDriveFile, response.headers.get("etag"));
  }

  const uploadSession = await createGoogleDriveFileUploadSession({
    accessToken: access.accessToken,
    parentItemId: input.parentItemId,
    name: input.name,
    localFilePath: input.localFilePath,
    fileSize: fileStats.size
  });
  return uploadGoogleDriveNewFileViaSession({
    uploadSession,
    localFilePath: input.localFilePath
  });
}

export async function deleteGoogleDriveRemoteItem(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
}): Promise<void> {
  const access = await resolveGoogleDriveAccess({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    requireWriteAccess: true
  });
  const itemReference = decodeGoogleDriveItemReference(input.itemId);
  const { response, payload } = await fetchGoogleDriveWithRetry({
    execute: () => fetch(`${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(itemReference.itemId)}?supportsAllDrives=true`, {
      method: "DELETE",
      headers: buildSourceBearerHeaders(access.accessToken, buildGoogleDriveResourceKeyHeader(itemReference))
    })
  });

  if (!(response.ok || response.status === 204 || response.status === 404)) {
    throwGoogleDriveHttpError("Google Drive delete failed", payload, response.status);
  }
}
