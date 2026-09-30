import fsPromises from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceSourceAccess } from "../sources/source-access.js";
import { getSourceCatalogEntry } from "../sources/source-catalog.js";
import {
  buildRcloneChildItemId,
  buildRcloneRemotePath,
  getRcloneParentItemId,
  normalizeRcloneItemId,
  parseRcloneSourceConfig
} from "../sources/rclone-config.js";
import {
  createRcloneCatResponse,
  RcloneCommandError,
  rcloneCopyTo,
  rcloneDeleteFile,
  rcloneLsjson,
  rcloneMkdir,
  rclonePurge,
  type RcloneListJsonItem
} from "../sources/rclone-cli.js";
import type { SourceDownloadResult } from "../sources/source-types.js";
import type { SourceFileLinkRemoteSnapshot } from "./types.js";
import {
  SourceFileLinkProviderError,
  SourceFileLinkRemoteConflictError,
  SourceFileLinkRemoteMissingError
} from "./provider-errors.js";

function parseRcloneDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

function getRcloneItemRelativePath(item: RcloneListJsonItem, fallbackItemId?: string): string {
  return normalizeRcloneItemId(item.Path ?? item.Name ?? fallbackItemId ?? "");
}

function getRcloneItemName(item: RcloneListJsonItem, fallbackItemId?: string): string {
  const name = item.Name?.trim();
  if (name) {
    return name;
  }

  const itemPath = getRcloneItemRelativePath(item, fallbackItemId);
  return itemPath ? path.posix.basename(itemPath) : "rclone";
}

function getBestRcloneHash(item: RcloneListJsonItem): string | null {
  const hashes = item.Hashes && typeof item.Hashes === "object" ? item.Hashes : {};
  const hashEntry = Object.entries(hashes)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .sort(([left], [right]) => left.localeCompare(right))[0];
  return hashEntry ? `${hashEntry[0]}:${hashEntry[1]}` : null;
}

function getRcloneFingerprint(item: RcloneListJsonItem): string | null {
  const hash = getBestRcloneHash(item);
  if (hash) {
    return hash;
  }

  const size = typeof item.Size === "number" && Number.isFinite(item.Size) ? String(item.Size) : "";
  const modifiedAt = parseRcloneDate(item.ModTime) ?? "";
  return size || modifiedAt ? `size:${size}:mtime:${modifiedAt}` : null;
}

function mapRemoteSnapshot(item: RcloneListJsonItem, fallbackItemId?: string): SourceFileLinkRemoteSnapshot {
  const itemId = getRcloneItemRelativePath(item, fallbackItemId);
  if (!itemId && fallbackItemId !== "") {
    throw new Error("rclone did not return valid item metadata.");
  }

  const kind = item.IsDir ? "folder" : "file";
  const fingerprint = getRcloneFingerprint(item);
  return {
    itemId,
    kind,
    name: getRcloneItemName(item, fallbackItemId),
    mimeType: kind === "file" ? item.MimeType ?? null : null,
    webUrl: null,
    modifiedAt: parseRcloneDate(item.ModTime),
    sizeBytes: kind === "file" && typeof item.Size === "number" && Number.isFinite(item.Size) ? item.Size : null,
    eTag: fingerprint,
    cTag: fingerprint
  };
}

function throwRcloneProviderError(prefix: string, error: unknown): never {
  if (error instanceof RcloneCommandError) {
    const text = `${error.message}\n${error.stderr}`.toLowerCase();
    if (
      text.includes("directory not found")
      || text.includes("object not found")
      || text.includes("file not found")
      || text.includes("couldn't find")
      || text.includes("not exist")
    ) {
      throw new SourceFileLinkRemoteMissingError("The remote rclone item no longer exists.");
    }

    throw new SourceFileLinkProviderError(`${prefix}: ${error.stderr.trim() || error.message}`, {
      statusCode: 502,
      upstreamStatus: error.exitCode,
      retryable: true
    });
  }

  throw error;
}

function requireRcloneSource(sourceId: string): void {
  const source = getSourceCatalogEntry(sourceId);
  if (!source || source.provider !== "rclone") {
    throw new Error("rclone live sync is only supported for rclone file sources.");
  }
}

async function resolveRcloneAccess(input: {
  workspaceId: string;
  sourceId: string;
}) {
  requireRcloneSource(input.sourceId);
  return resolveWorkspaceSourceAccess({
    workspaceId: input.workspaceId,
    provider: "rclone",
    requiresAdminCredentials: false
  });
}

async function fetchRcloneMetadata(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
}): Promise<{ item: RcloneListJsonItem; config: ReturnType<typeof parseRcloneSourceConfig> }> {
  const access = await resolveRcloneAccess(input);
  const sourceConfig = parseRcloneSourceConfig(access.connection.tokens);
  try {
    const item = await rcloneLsjson({
      sourceConfig,
      remotePath: buildRcloneRemotePath(sourceConfig, input.itemId),
      stat: true,
      hash: true
    }) as RcloneListJsonItem;
    return {
      item: { ...item, Path: normalizeRcloneItemId(input.itemId) },
      config: sourceConfig
    };
  } catch (error) {
    throwRcloneProviderError("rclone metadata request failed", error);
  }
}

export async function fetchRcloneRemoteSnapshot(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
  requireWriteAccess?: boolean;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const { item } = await fetchRcloneMetadata(input);
  return mapRemoteSnapshot(item, normalizeRcloneItemId(input.itemId));
}

export async function uploadRcloneRemoteFile(input: {
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

  const before = await fetchRcloneMetadata(input);
  const beforeSnapshot = mapRemoteSnapshot(before.item, input.itemId);
  if (beforeSnapshot.kind !== "file") {
    throw new Error("rclone folders cannot be overwritten with a file upload.");
  }
  if (input.ifMatchEtag && beforeSnapshot.eTag && input.ifMatchEtag !== beforeSnapshot.eTag) {
    throw new SourceFileLinkRemoteConflictError("The remote rclone file changed since the last sync.");
  }

  try {
    await rcloneCopyTo({
      sourceConfig: before.config,
      sourcePath: input.localFilePath,
      destinationPath: buildRcloneRemotePath(before.config, input.itemId)
    });
  } catch (error) {
    throwRcloneProviderError("rclone upload failed", error);
  }

  return fetchRcloneRemoteSnapshot(input);
}

export async function listRcloneRemoteFolderChildren(input: {
  workspaceId: string;
  sourceId: string;
  folderItemId: string;
}): Promise<SourceFileLinkRemoteSnapshot[]> {
  const access = await resolveRcloneAccess(input);
  const sourceConfig = parseRcloneSourceConfig(access.connection.tokens);
  try {
    const items = await rcloneLsjson({
      sourceConfig,
      remotePath: buildRcloneRemotePath(sourceConfig, input.folderItemId),
      hash: true
    });
    const folderItemId = normalizeRcloneItemId(input.folderItemId);
    return (Array.isArray(items) ? items : []).map((item) => {
      const childPath = normalizeRcloneItemId(item.Path ?? item.Name ?? "");
      const itemId = childPath ? normalizeRcloneItemId(path.posix.join(folderItemId, childPath)) : folderItemId;
      return mapRemoteSnapshot({ ...item, Path: itemId }, itemId);
    });
  } catch (error) {
    throwRcloneProviderError("rclone folder browse failed", error);
  }
}

export async function downloadRcloneRemoteFile(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
}): Promise<SourceDownloadResult> {
  const { item, config } = await fetchRcloneMetadata(input);
  const snapshot = mapRemoteSnapshot(item, input.itemId);
  if (snapshot.kind !== "file") {
    throw new Error("rclone folders cannot be downloaded as files.");
  }

  return {
    fileName: snapshot.name,
    mimeType: snapshot.mimeType,
    sizeBytes: snapshot.sizeBytes,
    modifiedAt: snapshot.modifiedAt,
    response: await createRcloneCatResponse({
      sourceConfig: config,
      remotePath: buildRcloneRemotePath(config, input.itemId)
    })
  };
}

export async function createRcloneRemoteFolder(input: {
  workspaceId: string;
  sourceId: string;
  parentItemId: string;
  name: string;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const access = await resolveRcloneAccess(input);
  const sourceConfig = parseRcloneSourceConfig(access.connection.tokens);
  const itemId = buildRcloneChildItemId(input.parentItemId, input.name);
  try {
    await rcloneMkdir({
      sourceConfig,
      remotePath: buildRcloneRemotePath(sourceConfig, itemId)
    });
  } catch (error) {
    throwRcloneProviderError("rclone folder create failed", error);
  }

  return fetchRcloneRemoteSnapshot({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    itemId
  });
}

export async function uploadNewRcloneRemoteFile(input: {
  workspaceId: string;
  sourceId: string;
  parentItemId: string;
  localFilePath: string;
  name: string;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const fileStats = await fsPromises.stat(input.localFilePath);
  if (!fileStats.isFile()) {
    throw new Error("Local live sync path is not a file.");
  }

  const access = await resolveRcloneAccess(input);
  const sourceConfig = parseRcloneSourceConfig(access.connection.tokens);
  const itemId = buildRcloneChildItemId(input.parentItemId, input.name);
  try {
    await rcloneCopyTo({
      sourceConfig,
      sourcePath: input.localFilePath,
      destinationPath: buildRcloneRemotePath(sourceConfig, itemId)
    });
  } catch (error) {
    throwRcloneProviderError("rclone upload failed", error);
  }

  return fetchRcloneRemoteSnapshot({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    itemId
  });
}

export async function deleteRcloneRemoteItem(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
}): Promise<void> {
  const { item, config } = await fetchRcloneMetadata(input);
  const itemId = normalizeRcloneItemId(input.itemId);
  try {
    if (item.IsDir) {
      await rclonePurge({
        sourceConfig: config,
        remotePath: buildRcloneRemotePath(config, itemId)
      });
    } else {
      await rcloneDeleteFile({
        sourceConfig: config,
        remotePath: buildRcloneRemotePath(config, itemId)
      });
    }
  } catch (error) {
    throwRcloneProviderError("rclone delete failed", error);
  }
}
