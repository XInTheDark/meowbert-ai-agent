import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { isWithinPath } from "@meowbert/shared";
import { toIsoTimestamp } from "../files/file-paths.js";
import type { SourceFileLinkLocalSnapshot } from "./types.js";
import { snapshotLiveSyncPath } from "./linux-safe-fs.js";

async function resolveAbsolutePathWithinRoot(rootPath: string, relativePath: string): Promise<string> {
  const rootRealPath = await fsPromises.realpath(rootPath);
  const absolutePath = path.resolve(rootRealPath, relativePath);
  if (!isWithinPath(rootRealPath, absolutePath)) {
    throw new Error("Path is outside environment root");
  }

  const relativePathFromRoot = path.relative(rootRealPath, absolutePath);
  const segments = relativePathFromRoot.split(path.sep).filter((segment) => segment.length > 0);
  let currentPath = rootRealPath;
  for (let index = 0; index < segments.length; index += 1) {
    currentPath = path.join(currentPath, segments[index]);
    const stats = await fsPromises.lstat(currentPath).catch(() => null);
    if (!stats) {
      break;
    }
    if (stats.isSymbolicLink()) {
      throw new Error("Live sync paths cannot contain symbolic links");
    }
    if (index < segments.length - 1 && !stats.isDirectory()) {
      throw new Error("Live sync path contains a non-directory parent");
    }

    const realCurrentPath = await fsPromises.realpath(currentPath);
    if (!isWithinPath(rootRealPath, realCurrentPath)) {
      throw new Error("Live sync path escapes the environment root");
    }
  }
  return absolutePath;
}

async function openRegularFileWithoutFollowingSymlink(absolutePath: string) {
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
    return fileHandle;
  } catch (error) {
    await fileHandle.close();
    throw error;
  }
}

async function computeFileHash(absolutePath: string): Promise<string> {
  const hash = createHash("sha256");
  const fileHandle = await openRegularFileWithoutFollowingSymlink(absolutePath);
  try {
    await pipeline(fileHandle.createReadStream(), hash);
  } finally {
    await fileHandle.close().catch(() => {});
  }
  return hash.digest("hex");
}

export async function stageSourceFileLinkSnapshot(input: {
  environmentRootPath: string;
  localRelativePath: string;
}): Promise<{ localPath: string; cleanup: () => Promise<void> }> {
  const stagingDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-live-sync-snapshot-"));
  const stagedPath = path.join(stagingDirectory, "source");

  try {
    await snapshotLiveSyncPath({
      environmentRootPath: input.environmentRootPath,
      localRelativePath: input.localRelativePath,
      stagedPath
    });
  } catch (error) {
    await fsPromises.rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    localPath: stagedPath,
    cleanup: async () => {
      await fsPromises.rm(stagingDirectory, { recursive: true, force: true });
    }
  };
}

async function collectDirectorySnapshot(input: {
  absolutePath: string;
  includeHash: boolean;
}): Promise<{
  sizeBytes: number;
  modifiedAt: string | null;
  hash: string | null;
}> {
  const entries: Array<{ relativePath: string; kind: "file" | "folder"; sizeBytes: number | null; hash: string | null }> = [];
  let totalSizeBytes = 0;
  const rootStats = await fsPromises.lstat(input.absolutePath);
  if (!rootStats.isDirectory()) {
    throw new Error("Live sync folder snapshot must be a directory");
  }
  let latestModifiedTime = rootStats.mtimeMs;

  const visit = async (directoryPath: string, relativeDirectory: string): Promise<void> => {
    const children = await fsPromises.readdir(directoryPath, { withFileTypes: true });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const childAbsolutePath = path.join(directoryPath, child.name);
      const childRelativePath = path.posix.join(relativeDirectory, child.name);
      const stats = await fsPromises.lstat(childAbsolutePath);
      if (stats.isSymbolicLink()) {
        throw new Error("Live sync folders cannot contain symbolic links");
      }
      latestModifiedTime = Math.max(latestModifiedTime, stats.mtimeMs);

      if (stats.isDirectory()) {
        entries.push({
          relativePath: childRelativePath,
          kind: "folder",
          sizeBytes: null,
          hash: null
        });
        await visit(childAbsolutePath, childRelativePath);
        continue;
      }

      if (!stats.isFile()) {
        continue;
      }

      totalSizeBytes += stats.size;
      entries.push({
        relativePath: childRelativePath,
        kind: "file",
        sizeBytes: stats.size,
        hash: input.includeHash ? await computeFileHash(childAbsolutePath) : null
      });
    }
  };

  await visit(input.absolutePath, "");

  if (!input.includeHash) {
    return {
      sizeBytes: totalSizeBytes,
      modifiedAt: latestModifiedTime > 0 ? new Date(latestModifiedTime).toISOString() : null,
      hash: null
    };
  }

  const treeHash = createHash("sha256");
  for (const entry of entries) {
    treeHash.update(entry.kind);
    treeHash.update("\0");
    treeHash.update(entry.relativePath);
    treeHash.update("\0");
    treeHash.update(entry.sizeBytes === null ? "" : String(entry.sizeBytes));
    treeHash.update("\0");
    treeHash.update(entry.hash ?? "");
    treeHash.update("\n");
  }

  return {
    sizeBytes: totalSizeBytes,
    modifiedAt: latestModifiedTime > 0 ? new Date(latestModifiedTime).toISOString() : null,
    hash: treeHash.digest("hex")
  };
}

export async function readSourceFileLinkLocalSnapshot(input: {
  environmentRootPath: string;
  localRelativePath: string;
  includeHash?: boolean;
}): Promise<SourceFileLinkLocalSnapshot> {
  const initialPath = await resolveAbsolutePathWithinRoot(input.environmentRootPath, input.localRelativePath);
  const initialStats = await fsPromises.lstat(initialPath).catch(() => null);
  if (initialStats?.isSymbolicLink()) {
    throw new Error("Live sync paths cannot contain symbolic links");
  }
  if (!initialStats || (!initialStats.isFile() && !initialStats.isDirectory())) {
    return {
      exists: false,
      relativePath: input.localRelativePath,
      kind: null,
      sizeBytes: null,
      modifiedAt: null,
      hash: null
    };
  }

  const staged = await stageSourceFileLinkSnapshot({
    environmentRootPath: input.environmentRootPath,
    localRelativePath: input.localRelativePath
  });
  const stats = await fsPromises.lstat(staged.localPath).catch(() => null);
  if (stats?.isSymbolicLink()) {
    throw new Error("Live sync paths cannot contain symbolic links");
  }
  if (!stats || (!stats.isFile() && !stats.isDirectory())) {
    await staged.cleanup();
    throw new Error("Live sync snapshot is missing its copied source");
  }

  try {
    if (stats.isDirectory()) {
      const directorySnapshot = await collectDirectorySnapshot({
        absolutePath: staged.localPath,
        includeHash: input.includeHash === true
      });
      return {
        exists: true,
        relativePath: input.localRelativePath,
        kind: "folder",
        sizeBytes: directorySnapshot.sizeBytes,
        modifiedAt: directorySnapshot.modifiedAt,
        hash: directorySnapshot.hash
      };
    }

    return {
      exists: true,
      relativePath: input.localRelativePath,
      kind: "file",
      sizeBytes: stats.size,
      modifiedAt: toIsoTimestamp(stats.mtime),
      hash: input.includeHash ? await computeFileHash(staged.localPath) : null
    };
  } finally {
    await staged.cleanup();
  }
}

export async function resolveSourceFileLinkAbsolutePath(input: {
  environmentRootPath: string;
  localRelativePath: string;
}): Promise<string> {
  return resolveAbsolutePathWithinRoot(input.environmentRootPath, input.localRelativePath);
}

export async function stageSourceFileLinkUpload(input: {
  environmentRootPath: string;
  localRelativePath: string;
}): Promise<{ localFilePath: string; cleanup: () => Promise<void> }> {
  const staged = await stageSourceFileLinkSnapshot(input);
  const stats = await fsPromises.lstat(staged.localPath).catch(() => null);
  if (!stats?.isFile()) {
    await staged.cleanup();
    throw new Error("Live sync source must be a regular file");
  }

  return {
    localFilePath: staged.localPath,
    cleanup: staged.cleanup
  };
}
