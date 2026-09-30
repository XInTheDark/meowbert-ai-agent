import fsPromises from "node:fs/promises";
import { resolveWorkspaceSourceAccess } from "../sources/source-access.js";
import { getSourceCatalogEntry } from "../sources/source-catalog.js";
import { sourceConnectionCanWrite } from "../sources/workspace-source-connections.js";
import type { SourceDownloadResult, StoredSourceTokens } from "../sources/source-types.js";
import type { SourceFileLinkRemoteSnapshot } from "./types.js";
import {
  SourceFileLinkProviderError,
  SourceFileLinkRemoteConflictError,
  SourceFileLinkRemoteMissingError
} from "./provider-errors.js";
import { parseResponsePayload } from "./remote-http-utils.js";

const PCLOUD_DEFAULT_API_HOST = "api.pcloud.com";
const PCLOUD_ALLOWED_API_HOSTS = new Set(["api.pcloud.com", "eapi.pcloud.com"]);

interface PCloudEnvelope {
  result?: number;
  error?: string;
}

interface PCloudMetadata {
  id?: string;
  fileid?: number | string;
  folderid?: number | string;
  parentfolderid?: number | string;
  name?: string;
  isfolder?: boolean;
  contenttype?: string;
  size?: number | string;
  modified?: string;
  hash?: number | string;
  contents?: PCloudMetadata[];
}

function normalizePCloudApiHost(value: unknown): string {
  const hostname = typeof value === "string" ? value.trim().toLowerCase() : "";
  return PCLOUD_ALLOWED_API_HOSTS.has(hostname) ? hostname : PCLOUD_DEFAULT_API_HOST;
}

function resolvePCloudApiHost(tokens: StoredSourceTokens): string {
  return normalizePCloudApiHost(tokens.raw.hostname ?? tokens.raw.api_hostname);
}

function decodePCloudItemId(itemId: string): { kind: "file" | "folder"; numericId: string } {
  const match = itemId.trim().match(/^([fd])(\d+)$/i);
  if (!match) {
    throw new Error("pCloud item IDs must use pCloud metadata IDs such as f123 or d456.");
  }
  return {
    kind: match[1].toLowerCase() === "d" ? "folder" : "file",
    numericId: match[2]
  };
}

function buildPCloudUrl(input: {
  accessToken: string;
  tokens: StoredSourceTokens;
  method: string;
  params?: Record<string, string>;
}): URL {
  const url = new URL(`https://${resolvePCloudApiHost(input.tokens)}/${input.method}`);
  url.searchParams.set("access_token", input.accessToken);
  for (const [key, value] of Object.entries(input.params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

function throwPCloudError(prefix: string, payload: unknown, status = 200): never {
  if (status === 404) {
    throw new SourceFileLinkRemoteMissingError("The remote pCloud item no longer exists.");
  }

  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as PCloudEnvelope
    : {};
  if (record.result === 2009 || record.result === 2005) {
    throw new SourceFileLinkRemoteMissingError("The remote pCloud item no longer exists.");
  }
  if (record.result === 2003) {
    throw new SourceFileLinkProviderError(`${prefix}: pCloud denied access to this item.`, { statusCode: 403 });
  }

  throw new SourceFileLinkProviderError(
    `${prefix}: ${record.error ?? (record.result !== undefined ? `pCloud result ${record.result}` : `HTTP ${status}`)}`,
    {
      statusCode: status >= 400 && status < 500 ? status : 500,
      upstreamStatus: status,
      retryable: status >= 500 || record.result === 5000 || record.result === 5001
    }
  );
}

async function fetchPCloudJson<T extends PCloudEnvelope>(input: {
  accessToken: string;
  tokens: StoredSourceTokens;
  method: string;
  params?: Record<string, string>;
  errorPrefix: string;
}): Promise<T> {
  const response = await fetch(buildPCloudUrl(input));
  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    throwPCloudError(input.errorPrefix, payload, response.status);
  }
  const typed = payload as T;
  if (typed.result !== undefined && typed.result !== 0) {
    throwPCloudError(input.errorPrefix, typed);
  }
  return typed;
}

function parsePCloudDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function mapRemoteSnapshot(item: PCloudMetadata): SourceFileLinkRemoteSnapshot {
  const kind = item.isfolder ? "folder" : "file";
  const numericId = kind === "folder" ? item.folderid : item.fileid;
  const itemId = typeof item.id === "string" && item.id.length > 0
    ? item.id
    : `${kind === "folder" ? "d" : "f"}${String(numericId ?? "")}`;
  if (!itemId || !item.name) {
    throw new Error("pCloud did not return valid item metadata.");
  }

  const hash = item.hash === undefined ? null : String(item.hash);
  return {
    itemId,
    kind,
    name: item.name,
    mimeType: kind === "file" ? item.contenttype ?? null : null,
    webUrl: null,
    modifiedAt: parsePCloudDate(item.modified),
    sizeBytes: kind === "file" ? parseNullableNumber(item.size) : null,
    eTag: hash,
    cTag: hash ?? parsePCloudDate(item.modified)
  };
}

function requirePCloudSource(sourceId: string): void {
  const source = getSourceCatalogEntry(sourceId);
  if (!source || source.provider !== "pcloud") {
    throw new Error("pCloud live sync is only supported for pCloud file sources.");
  }
}

async function resolvePCloudAccess(input: {
  workspaceId: string;
  sourceId: string;
  requireWriteAccess?: boolean;
}) {
  requirePCloudSource(input.sourceId);
  const access = await resolveWorkspaceSourceAccess({
    workspaceId: input.workspaceId,
    provider: "pcloud"
  });

  if (input.requireWriteAccess === true && !sourceConnectionCanWrite(access.connection)) {
    throw new SourceFileLinkProviderError(
      "Reconnect the workspace pCloud source to grant write access before using live sync.",
      { statusCode: 409 }
    );
  }

  return access;
}

async function fetchPCloudMetadata(input: {
  accessToken: string;
  tokens: StoredSourceTokens;
  itemId: string;
}): Promise<PCloudMetadata> {
  const item = decodePCloudItemId(input.itemId);
  const payload = item.kind === "folder"
    ? await fetchPCloudJson<PCloudEnvelope & { metadata?: PCloudMetadata }>({
        accessToken: input.accessToken,
        tokens: input.tokens,
        method: "listfolder",
        params: { folderid: item.numericId },
        errorPrefix: "pCloud folder metadata request failed"
      })
    : await fetchPCloudJson<PCloudEnvelope & { metadata?: PCloudMetadata }>({
        accessToken: input.accessToken,
        tokens: input.tokens,
        method: "stat",
        params: { fileid: item.numericId },
        errorPrefix: "pCloud file metadata request failed"
      });
  if (!payload.metadata) {
    throw new Error("pCloud metadata response was invalid.");
  }
  return payload.metadata;
}

export async function fetchPCloudRemoteSnapshot(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
  requireWriteAccess?: boolean;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const access = await resolvePCloudAccess(input);
  return mapRemoteSnapshot(await fetchPCloudMetadata({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    itemId: input.itemId
  }));
}

async function uploadPCloudFile(input: {
  accessToken: string;
  tokens: StoredSourceTokens;
  parentFolderId: string;
  localFilePath: string;
  name: string;
  mtime?: string | null;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const fileBuffer = await fsPromises.readFile(input.localFilePath);
  const formData = new FormData();
  formData.set("filename", input.name);
  formData.set("folderid", input.parentFolderId);
  formData.set("nopartial", "1");
  if (input.mtime) {
    const seconds = Math.floor(Date.parse(input.mtime) / 1000);
    if (Number.isFinite(seconds)) {
      formData.set("mtime", `${seconds}`);
    }
  }
  formData.set("file", new Blob([fileBuffer]), input.name);

  const response = await fetch(buildPCloudUrl({
    accessToken: input.accessToken,
    tokens: input.tokens,
    method: "uploadfile"
  }), {
    method: "POST",
    body: formData
  });
  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    throwPCloudError("pCloud upload failed", payload, response.status);
  }
  const typed = payload as PCloudEnvelope & { metadata?: PCloudMetadata[] };
  if (typed.result !== undefined && typed.result !== 0) {
    throwPCloudError("pCloud upload failed", typed);
  }
  const uploaded = typed.metadata?.[0];
  if (!uploaded) {
    throw new Error("pCloud upload response did not include file metadata.");
  }
  return mapRemoteSnapshot(uploaded);
}

export async function uploadPCloudRemoteFile(input: {
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

  const access = await resolvePCloudAccess({ ...input, requireWriteAccess: true });
  const metadata = await fetchPCloudMetadata({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    itemId: input.itemId
  });
  const snapshot = mapRemoteSnapshot(metadata);
  if (input.ifMatchEtag && snapshot.eTag && input.ifMatchEtag !== snapshot.eTag) {
    throw new SourceFileLinkRemoteConflictError("The remote pCloud file changed since the last sync.");
  }
  if (snapshot.kind !== "file") {
    throw new Error("pCloud folders cannot be overwritten with a file upload.");
  }

  return uploadPCloudFile({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    parentFolderId: String(metadata.parentfolderid ?? 0),
    localFilePath: input.localFilePath,
    name: metadata.name ?? snapshot.name,
    mtime: new Date(fileStats.mtimeMs).toISOString()
  });
}

export async function listPCloudRemoteFolderChildren(input: {
  workspaceId: string;
  sourceId: string;
  folderItemId: string;
}): Promise<SourceFileLinkRemoteSnapshot[]> {
  const access = await resolvePCloudAccess(input);
  const folder = await fetchPCloudMetadata({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    itemId: input.folderItemId
  });
  return (folder.contents ?? []).map(mapRemoteSnapshot);
}

export async function downloadPCloudRemoteFile(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
}): Promise<SourceDownloadResult> {
  const access = await resolvePCloudAccess(input);
  const metadata = await fetchPCloudMetadata({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    itemId: input.itemId
  });
  if (metadata.isfolder) {
    throw new Error("pCloud folders cannot be downloaded as files.");
  }

  const item = decodePCloudItemId(input.itemId);
  const payload = await fetchPCloudJson<PCloudEnvelope & { hosts?: string[]; path?: string }>({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    method: "getfilelink",
    params: {
      fileid: item.numericId,
      forcedownload: "1"
    },
    errorPrefix: "pCloud download link request failed"
  });
  const host = payload.hosts?.[0];
  if (!host || !payload.path) {
    throw new Error("pCloud download link response was invalid.");
  }

  const response = await fetch(`https://${host}${payload.path}`);
  if (!response.ok) {
    const payloadText = await response.text().catch(() => "");
    throw new Error(`pCloud download failed: ${payloadText || `HTTP ${response.status}`}`);
  }

  return {
    fileName: metadata.name ?? "download.bin",
    mimeType: metadata.contenttype ?? null,
    sizeBytes: parseNullableNumber(metadata.size),
    modifiedAt: parsePCloudDate(metadata.modified),
    response
  };
}

export async function createPCloudRemoteFolder(input: {
  workspaceId: string;
  sourceId: string;
  parentItemId: string;
  name: string;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const access = await resolvePCloudAccess({ ...input, requireWriteAccess: true });
  const parent = decodePCloudItemId(input.parentItemId);
  if (parent.kind !== "folder") {
    throw new Error("pCloud parent item must be a folder.");
  }

  const payload = await fetchPCloudJson<PCloudEnvelope & { metadata?: PCloudMetadata }>({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    method: "createfolder",
    params: {
      folderid: parent.numericId,
      name: input.name
    },
    errorPrefix: "pCloud folder create failed"
  });
  if (!payload.metadata) {
    throw new Error("pCloud folder create response did not include metadata.");
  }
  return mapRemoteSnapshot(payload.metadata);
}

export async function uploadNewPCloudRemoteFile(input: {
  workspaceId: string;
  sourceId: string;
  parentItemId: string;
  localFilePath: string;
  name: string;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const access = await resolvePCloudAccess({ ...input, requireWriteAccess: true });
  const parent = decodePCloudItemId(input.parentItemId);
  if (parent.kind !== "folder") {
    throw new Error("pCloud parent item must be a folder.");
  }
  const fileStats = await fsPromises.stat(input.localFilePath);
  return uploadPCloudFile({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    parentFolderId: parent.numericId,
    localFilePath: input.localFilePath,
    name: input.name,
    mtime: new Date(fileStats.mtimeMs).toISOString()
  });
}

export async function deletePCloudRemoteItem(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
}): Promise<void> {
  const access = await resolvePCloudAccess({ ...input, requireWriteAccess: true });
  const item = decodePCloudItemId(input.itemId);
  const method = item.kind === "folder" ? "deletefolderrecursive" : "deletefile";
  const params: Record<string, string> = item.kind === "folder"
    ? { folderid: item.numericId }
    : { fileid: item.numericId };
  await fetchPCloudJson({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    method,
    params,
    errorPrefix: "pCloud delete failed"
  });
}
