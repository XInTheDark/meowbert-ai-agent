import fsPromises from "node:fs/promises";
import path from "node:path";
import type { ResolvedRootPath } from "@meowbert/shared/server-security";
import { toIsoTimestamp, toWebPath } from "./file-paths.js";

export interface DirectoryEntry {
  name: string;
  relativePath: string;
  kind: "directory" | "file" | "symlink" | "other";
  sizeBytes: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
}

export interface DirectoryListing {
  cwd: string;
  parentPath: string | null;
  items: DirectoryEntry[];
}

function entryKind(stats: Awaited<ReturnType<typeof fsPromises.lstat>> | null): DirectoryEntry["kind"] {
  if (stats?.isDirectory()) return "directory";
  if (stats?.isFile()) return "file";
  if (stats?.isSymbolicLink()) return "symlink";
  return "other";
}

function kindRank(kind: DirectoryEntry["kind"]): number {
  return kind === "directory" ? 0 : kind === "file" ? 1 : 2;
}

function parentPathOf(relativePath: string): string | null {
  if (relativePath === "") {
    return null;
  }
  const parent = path.dirname(relativePath);
  return parent === "." ? "" : toWebPath(parent);
}

// Lists one directory level: folders first, then files, each sorted by name.
export async function listDirectory(target: ResolvedRootPath): Promise<DirectoryListing> {
  const folderStats = await fsPromises.lstat(target.absolutePath).catch(() => null);
  if (!folderStats || !folderStats.isDirectory()) {
    throw new Error("Directory not found");
  }

  const entries = await fsPromises.readdir(target.absolutePath, { withFileTypes: true });
  const items = await Promise.all(
    entries.map(async (entry): Promise<DirectoryEntry> => {
      const absoluteEntryPath = path.join(target.absolutePath, entry.name);
      const entryStats = await fsPromises.lstat(absoluteEntryPath).catch(() => null);
      return {
        name: entry.name,
        relativePath: toWebPath(path.relative(target.rootRealPath, absoluteEntryPath)),
        kind: entryKind(entryStats),
        sizeBytes: entryStats?.isFile() ? entryStats.size : null,
        createdAt: toIsoTimestamp(entryStats?.birthtime),
        modifiedAt: toIsoTimestamp(entryStats?.mtime)
      };
    })
  );

  items.sort((left, right) => (
    kindRank(left.kind) - kindRank(right.kind)
    || left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  ));

  return {
    cwd: target.relativePath,
    parentPath: parentPathOf(target.relativePath),
    items
  };
}
