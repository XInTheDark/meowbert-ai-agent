import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import type { SourceFileLink, SourceFileLinkLocalSnapshot, SourceFileLinkRemoteSnapshot } from "./types.js";
import type { SourceFileLinkRemoteProviderClient } from "./remote-provider.js";
import {
  readSourceFileLinkLocalSnapshot,
  stageSourceFileLinkSnapshot
} from "./local-file-state.js";
import { replaceLiveSyncDirectoryFromPath } from "./linux-safe-fs.js";

interface RemoteTreeEntry {
  relativePath: string;
  snapshot: SourceFileLinkRemoteSnapshot;
}

interface LocalTreeEntry {
  relativePath: string;
  kind: "file" | "folder";
  absolutePath: string;
  sizeBytes: number | null;
  hash: string | null;
}

function sanitizeRemotePathSegment(input: {
  name: string;
  itemId: string;
}): string {
  const sanitized = input.name
    .trim()
    .replace(/[\\/\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ");
  if (!sanitized || sanitized === "." || sanitized === "..") {
    return `item-${input.itemId.slice(0, 8) || Date.now().toString(36)}`;
  }
  return sanitized;
}

function makeUniqueRemotePathSegment(input: {
  name: string;
  itemId: string;
  usedSegments: Set<string>;
}): string {
  const segment = sanitizeRemotePathSegment(input);
  if (!input.usedSegments.has(segment)) {
    input.usedSegments.add(segment);
    return segment;
  }

  const extension = path.posix.extname(segment);
  const base = extension ? segment.slice(0, -extension.length) : segment;
  for (let index = 1; index < 200; index += 1) {
    const candidate = `${base} (${index})${extension}`;
    if (!input.usedSegments.has(candidate)) {
      input.usedSegments.add(candidate);
      return candidate;
    }
  }

  const fallback = `${base}-${input.itemId.slice(0, 8) || Date.now().toString(36)}${extension}`;
  input.usedSegments.add(fallback);
  return fallback;
}

function hashRemoteTree(entries: RemoteTreeEntry[]): string {
  const hash = createHash("sha256");
  for (const entry of entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    hash.update(entry.snapshot.kind);
    hash.update("\0");
    hash.update(entry.relativePath);
    hash.update("\0");
    hash.update(entry.snapshot.sizeBytes === null ? "" : String(entry.snapshot.sizeBytes));
    hash.update("\0");
    hash.update(entry.snapshot.eTag ?? "");
    hash.update("\0");
    hash.update(entry.snapshot.cTag ?? "");
    hash.update("\0");
    hash.update(entry.snapshot.modifiedAt ?? "");
    hash.update("\n");
  }
  return hash.digest("hex");
}

function summarizeRemoteFolder(root: SourceFileLinkRemoteSnapshot, entries: RemoteTreeEntry[]): SourceFileLinkRemoteSnapshot {
  let sizeBytes = 0;
  let latestModifiedTime = root.modifiedAt ? Date.parse(root.modifiedAt) : 0;
  for (const entry of entries) {
    if (typeof entry.snapshot.sizeBytes === "number") {
      sizeBytes += entry.snapshot.sizeBytes;
    }
    if (entry.snapshot.modifiedAt) {
      const modifiedTime = Date.parse(entry.snapshot.modifiedAt);
      if (Number.isFinite(modifiedTime)) {
        latestModifiedTime = Math.max(latestModifiedTime, modifiedTime);
      }
    }
  }

  return {
    ...root,
    kind: "folder",
    sizeBytes,
    modifiedAt: latestModifiedTime > 0 ? new Date(latestModifiedTime).toISOString() : root.modifiedAt,
    cTag: hashRemoteTree(entries)
  };
}

export async function readRemoteFolderSnapshot(input: {
  link: SourceFileLink;
  remoteProvider: SourceFileLinkRemoteProviderClient;
}): Promise<SourceFileLinkRemoteSnapshot> {
  const tree = await readRemoteFolderTree(input);
  return summarizeRemoteFolder(tree.root, tree.entries);
}

async function readRemoteFolderTree(input: {
  link: SourceFileLink;
  remoteProvider: SourceFileLinkRemoteProviderClient;
}): Promise<{ root: SourceFileLinkRemoteSnapshot; entries: RemoteTreeEntry[] }> {
  const root = await input.remoteProvider.fetchRemoteSnapshot({
    workspaceId: input.link.workspaceId,
    sourceId: input.link.sourceId,
    itemId: input.link.remoteItemId
  });
  if (root.kind !== "folder") {
    throw new Error("The remote live sync item is no longer a folder.");
  }

  const entries: RemoteTreeEntry[] = [];
  const visit = async (folderItemId: string, relativeFolderPath: string): Promise<void> => {
    const children = await input.remoteProvider.listRemoteFolderChildren({
      workspaceId: input.link.workspaceId,
      sourceId: input.link.sourceId,
      folderItemId
    });
    const usedSegments = new Set<string>();

    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const childSegment = makeUniqueRemotePathSegment({
        name: child.name,
        itemId: child.itemId,
        usedSegments
      });
      const childRelativePath = path.posix.join(relativeFolderPath, childSegment);
      entries.push({ relativePath: childRelativePath, snapshot: child });
      if (child.kind === "folder") {
        await visit(child.itemId, childRelativePath);
      }
    }
  };

  await visit(root.itemId, "");
  return { root, entries };
}

async function computeFileHash(absolutePath: string): Promise<string> {
  const hash = createHash("sha256");
  const fileHandle = await fsPromises.open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const [openedStats, currentStats] = await Promise.all([
      fileHandle.stat(),
      fsPromises.lstat(absolutePath)
    ]);
    if (currentStats.isSymbolicLink() || !currentStats.isFile() || !openedStats.isFile()) {
      throw new Error("Live sync source must be a regular file");
    }
    if (openedStats.dev !== currentStats.dev || openedStats.ino !== currentStats.ino) {
      throw new Error("Live sync source changed while it was being opened");
    }
    await pipeline(fileHandle.createReadStream(), hash);
  } finally {
    await fileHandle.close().catch(() => {});
  }
  return hash.digest("hex");
}

export async function readLocalFolderTree(input: {
  absolutePath: string;
}): Promise<LocalTreeEntry[]> {
  const entries: LocalTreeEntry[] = [];
  const visit = async (directoryPath: string, relativeDirectory: string): Promise<void> => {
    const children = await fsPromises.readdir(directoryPath, { withFileTypes: true });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directoryPath, child.name);
      const relativePath = path.posix.join(relativeDirectory, child.name);
      const stats = await fsPromises.lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new Error("Live sync folders cannot contain symbolic links");
      }

      if (stats.isDirectory()) {
        entries.push({ relativePath, kind: "folder", absolutePath, sizeBytes: null, hash: null });
        await visit(absolutePath, relativePath);
        continue;
      }

      if (stats.isFile()) {
        entries.push({
          relativePath,
          kind: "file",
          absolutePath,
          sizeBytes: stats.size,
          hash: await computeFileHash(absolutePath)
        });
      }
    }
  };

  await visit(input.absolutePath, "");
  return entries;
}

export function summarizeLocalFolder(input: {
  localRelativePath: string;
  entries: LocalTreeEntry[];
}): SourceFileLinkLocalSnapshot {
  const hash = createHash("sha256");
  let totalSizeBytes = 0;
  let latestModifiedTime = 0;

  for (const entry of input.entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    if (entry.sizeBytes !== null) {
      totalSizeBytes += entry.sizeBytes;
    }
    const stats = fs.lstatSync(entry.absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error("Live sync folders cannot contain symbolic links");
    }
    const modifiedTime = stats.mtimeMs;
    latestModifiedTime = Math.max(latestModifiedTime, modifiedTime);
    hash.update(entry.kind);
    hash.update("\0");
    hash.update(entry.relativePath);
    hash.update("\0");
    hash.update(entry.sizeBytes === null ? "" : String(entry.sizeBytes));
    hash.update("\0");
    hash.update(entry.hash ?? "");
    hash.update("\n");
  }

  return {
    exists: true,
    relativePath: input.localRelativePath,
    kind: "folder",
    sizeBytes: totalSizeBytes,
    modifiedAt: latestModifiedTime > 0 ? new Date(latestModifiedTime).toISOString() : null,
    hash: hash.digest("hex")
  };
}

export async function mirrorRemoteFolderToLocal(input: {
  link: SourceFileLink;
  remoteProvider: SourceFileLinkRemoteProviderClient;
  environmentRootPath: string;
  createParents?: boolean;
}): Promise<{ remote: SourceFileLinkRemoteSnapshot; local: SourceFileLinkLocalSnapshot }> {
  const tree = await readRemoteFolderTree({
    link: input.link,
    remoteProvider: input.remoteProvider
  });
  const stagedPath = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-live-sync-folder-"));

  try {
    for (const entry of tree.entries) {
      const absolutePath = path.join(stagedPath, ...entry.relativePath.split("/"));
      if (entry.snapshot.kind === "folder") {
        await fsPromises.mkdir(absolutePath, { recursive: true });
        continue;
      }

      const download = await input.remoteProvider.downloadRemoteFile({
        workspaceId: input.link.workspaceId,
        sourceId: input.link.sourceId,
        itemId: entry.snapshot.itemId
      });
      if (!download.response.body) {
        throw new Error("Live sync folder download returned an empty body.");
      }
      await fsPromises.mkdir(path.dirname(absolutePath), { recursive: true });
      await pipeline(
        Readable.fromWeb(download.response.body as unknown as NodeReadableStream),
        fs.createWriteStream(absolutePath, { mode: 0o600 })
      );
    }

    await replaceLiveSyncDirectoryFromPath({
      environmentRootPath: input.environmentRootPath,
      localRelativePath: input.link.localRelativePath,
      stagedPath,
      createParents: input.createParents
    });
  } finally {
    await fsPromises.rm(stagedPath, { recursive: true, force: true }).catch(() => {});
  }

  const local = await readSourceFileLinkLocalSnapshot({
    environmentRootPath: input.environmentRootPath,
    localRelativePath: input.link.localRelativePath,
    includeHash: true
  });
  if (local.kind !== "folder") {
    throw new Error("Live sync folder target was not installed as a folder.");
  }
  return {
    remote: summarizeRemoteFolder(tree.root, tree.entries),
    local
  };
}

export async function mirrorLocalFolderToRemote(input: {
  link: SourceFileLink;
  remoteProvider: SourceFileLinkRemoteProviderClient;
  environmentRootPath: string;
}): Promise<{ remote: SourceFileLinkRemoteSnapshot; local: SourceFileLinkLocalSnapshot }> {
  const remoteTree = await readRemoteFolderTree({
    link: input.link,
    remoteProvider: input.remoteProvider
  });
  const staged = await stageSourceFileLinkSnapshot({
    environmentRootPath: input.environmentRootPath,
    localRelativePath: input.link.localRelativePath
  });
  const stagedStats = await fsPromises.lstat(staged.localPath).catch(() => null);
  if (!stagedStats?.isDirectory()) {
    await staged.cleanup();
    throw new Error("Live sync source must be a directory");
  }
  const localEntries = await readLocalFolderTree({ absolutePath: staged.localPath });
  const remoteByPath = new Map(remoteTree.entries.map((entry) => [entry.relativePath, entry.snapshot]));
  const remoteFolderIdByPath = new Map<string, string>([["", remoteTree.root.itemId]]);

  for (const entry of remoteTree.entries) {
    if (entry.snapshot.kind === "folder") {
      remoteFolderIdByPath.set(entry.relativePath, entry.snapshot.itemId);
    }
  }

  try {
    for (const entry of localEntries.filter((candidate) => candidate.kind === "folder")) {
      const existing = remoteByPath.get(entry.relativePath);
      if (existing?.kind === "folder") {
        remoteFolderIdByPath.set(entry.relativePath, existing.itemId);
        continue;
      }
      if (existing) {
        await input.remoteProvider.deleteRemoteItem({
          workspaceId: input.link.workspaceId,
          sourceId: input.link.sourceId,
          itemId: existing.itemId
        });
      }

      const parentPath = path.posix.dirname(entry.relativePath);
      const normalizedParentPath = parentPath === "." ? "" : parentPath;
      const parentItemId = remoteFolderIdByPath.get(normalizedParentPath);
      if (!parentItemId) {
        throw new Error(`Missing remote parent folder for ${entry.relativePath}.`);
      }
      const created = await input.remoteProvider.createRemoteFolder({
        workspaceId: input.link.workspaceId,
        sourceId: input.link.sourceId,
        parentItemId,
        name: path.posix.basename(entry.relativePath)
      });
      remoteFolderIdByPath.set(entry.relativePath, created.itemId);
    }

    for (const entry of localEntries.filter((candidate) => candidate.kind === "file")) {
    const existing = remoteByPath.get(entry.relativePath);
      if (existing?.kind === "file") {
        await input.remoteProvider.uploadRemoteFile({
          workspaceId: input.link.workspaceId,
          sourceId: input.link.sourceId,
          itemId: existing.itemId,
          localFilePath: entry.absolutePath,
          ifMatchEtag: null
        });
        continue;
      }
      if (existing) {
        await input.remoteProvider.deleteRemoteItem({
          workspaceId: input.link.workspaceId,
          sourceId: input.link.sourceId,
          itemId: existing.itemId
        });
      }

      const parentPath = path.posix.dirname(entry.relativePath);
      const normalizedParentPath = parentPath === "." ? "" : parentPath;
      const parentItemId = remoteFolderIdByPath.get(normalizedParentPath);
      if (!parentItemId) {
        throw new Error(`Missing remote parent folder for ${entry.relativePath}.`);
      }
      await input.remoteProvider.uploadNewRemoteFile({
        workspaceId: input.link.workspaceId,
        sourceId: input.link.sourceId,
        parentItemId,
        localFilePath: entry.absolutePath,
        name: path.posix.basename(entry.relativePath)
      });
    }

    const localPathSet = new Set(localEntries.map((entry) => entry.relativePath));
    const remoteExtras = remoteTree.entries
      .filter((entry) => !localPathSet.has(entry.relativePath))
      .sort((left, right) => right.relativePath.length - left.relativePath.length);
    for (const entry of remoteExtras) {
      await input.remoteProvider.deleteRemoteItem({
        workspaceId: input.link.workspaceId,
        sourceId: input.link.sourceId,
        itemId: entry.snapshot.itemId
      });
    }

    const updatedRemoteTree = await readRemoteFolderTree({
      link: input.link,
      remoteProvider: input.remoteProvider
    });
    return {
      remote: summarizeRemoteFolder(updatedRemoteTree.root, updatedRemoteTree.entries),
      local: summarizeLocalFolder({
        localRelativePath: input.link.localRelativePath,
        entries: localEntries
      })
    };
  } finally {
    await staged.cleanup();
  }
}
