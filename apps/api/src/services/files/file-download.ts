import fsPromises from "node:fs/promises";
import path from "node:path";
import { resolveRealPathWithinRoot } from "@meowbert/shared/server-security";
import { buildBatchDownloadArchivePath } from "./batch-download-archive.js";
import { getFileContentType } from "./file-content-type.js";
import { resolveSelectedPathsWithinRoot } from "./selected-paths.js";

export type FileDownload =
  | { kind: "file"; absolutePath: string; filename: string; sizeBytes: number; contentType: string }
  | { kind: "directory"; absolutePath: string; filename: string };

export interface ArchiveEntry {
  absolutePath: string;
  archivePath: string;
  isDirectory: boolean;
}

// A single path downloads as the file itself, or as a zip when it is a directory.
export async function resolveFileDownload(rootPath: string, requestedPath: string): Promise<FileDownload> {
  const target = await resolveRealPathWithinRoot(rootPath, requestedPath);
  const fileStats = await fsPromises.lstat(target.absolutePath).catch(() => null);
  if (!fileStats) {
    throw new Error("File or directory not found");
  }

  const filename = path.basename(target.absolutePath);
  if (fileStats.isDirectory()) {
    return { kind: "directory", absolutePath: target.absolutePath, filename };
  }
  if (!fileStats.isFile()) {
    throw new Error("Not a file or directory");
  }

  return {
    kind: "file",
    absolutePath: target.absolutePath,
    filename,
    sizeBytes: fileStats.size,
    contentType: getFileContentType(target.absolutePath)
  };
}

// Plans the zip for a multi-select download, naming entries relative to the folder being viewed.
export async function resolveBatchDownloadEntries(input: {
  rootPath: string;
  requestedPaths: string[];
  currentDirectory: string;
  rootLabel: string;
}): Promise<ArchiveEntry[]> {
  const currentDirectory = input.currentDirectory.length > 0
    ? await resolveRealPathWithinRoot(input.rootPath, input.currentDirectory)
    : null;
  if (currentDirectory) {
    const currentDirectoryStats = await fsPromises.lstat(currentDirectory.absolutePath).catch(() => null);
    if (!currentDirectoryStats?.isDirectory()) {
      throw new Error("Current directory not found");
    }
  }

  const targets = await resolveSelectedPathsWithinRoot({
    rootPath: input.rootPath,
    requestedPaths: input.requestedPaths,
    rootLabel: input.rootLabel,
    action: "batch download"
  });

  return targets.map((target) => ({
    absolutePath: target.absolutePath,
    isDirectory: target.isDirectory,
    archivePath: buildBatchDownloadArchivePath({
      currentDirectory: currentDirectory?.relativePath ?? "",
      targetRelativePath: target.relativePath
    })
  }));
}
