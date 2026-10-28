import fsPromises from "node:fs/promises";
import type { IndexSourceStamp } from "./entry-file.js";
import { sourceAbsolutePath, type IndexedPath, type IndexScope } from "./locations.js";

// One stat per source. Freshness is an exact match on mtime and size, not "newer than": synced
// folders such as Drive can replace a file and keep an older mtime.

export type SourceStatus = "fresh" | "changed" | "missing";

export async function stampSource(source: IndexedPath): Promise<IndexSourceStamp> {
  const stats = await fsPromises.stat(source.absolutePath).catch(() => null);
  if (!stats) throw new Error(`Source not found: ${source.key}`);
  if (!stats.isFile() && !stats.isDirectory()) throw new Error(`Only files and folders can be indexed: ${source.key}`);
  const kind = stats.isDirectory() ? "folder" : "file";
  return { path: source.key, kind, mtime: stats.mtime.toISOString(), size: kind === "file" ? stats.size : null };
}

export async function checkSource(scope: IndexScope, stamp: IndexSourceStamp): Promise<SourceStatus> {
  const stats = await fsPromises.stat(sourceAbsolutePath(scope, stamp.path)).catch(() => null);
  if (!stats) return "missing";
  const kind = stats.isDirectory() ? "folder" : "file";
  const sameSize = kind === "folder" || stats.size === stamp.size;
  return kind === stamp.kind && stats.mtime.toISOString() === stamp.mtime && sameSize ? "fresh" : "changed";
}
