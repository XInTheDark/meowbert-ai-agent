import fsPromises from "node:fs/promises";
import path from "node:path";
import { ensureSandboxWritablePath } from "@meowbert/shared";
import { toSandboxPath } from "@meowbert/shared/docker-sandbox";
import { getWorkspaceMemoryDir } from "../memory/main-files.js";
import { parseIndexEntry, serializeIndexEntry, type IndexSourceStamp } from "./entry-file.js";
import { stampSource } from "./freshness.js";
import {
  commonFolderKey,
  fileEntryPath,
  folderEntryPath,
  groupEntryPath,
  resolveIndexedPath,
  type FileIndexRoots,
  type IndexedPath
} from "./locations.js";

// Writes an index entry and stamps each source as it looks now. The agent may edit entries by hand
// afterwards; this is the one place stamps are written, so they always match the storage.

export interface IndexSaveInput {
  sources: string[];
  summary: string;
  mode: "replace" | "append_update";
  name: string | null;
}

export interface IndexSaveResult {
  entry_path: string;
  mode: IndexSaveInput["mode"];
  sources: IndexSourceStamp[];
}

function resolveSources(roots: FileIndexRoots, requested: string[]): IndexedPath[] {
  const resolved = requested.map((value) => resolveIndexedPath(roots, value));
  const unique = [...new Map(resolved.map((source) => [source.key, source])).values()];
  if (unique.length === 0) throw new Error("At least one source path is required.");
  if (new Set(unique.map((source) => source.scope.name)).size > 1) {
    throw new Error("An entry's sources must all be inside the project, or all outside it.");
  }
  return unique;
}

function resolveEntryPath(source: IndexedPath, stamps: IndexSourceStamp[], name: string | null): string {
  if (stamps.length === 1) {
    return stamps[0].kind === "folder" ? folderEntryPath(source.scope, stamps[0].path) : fileEntryPath(source.scope, stamps[0].path);
  }
  if (!name?.trim()) throw new Error("An entry covering several paths needs a name.");
  return groupEntryPath(source.scope, commonFolderKey(stamps), name);
}

function buildBody(existingText: string | null, input: IndexSaveInput, indexedAt: string): string {
  if (input.mode === "replace" || existingText === null) return input.summary;
  const previousBody = parseIndexEntry(existingText)?.body ?? existingText;
  return `${previousBody}\n\n## Update ${indexedAt}\n\n${input.summary.trim()}`;
}

export async function saveIndexEntry(roots: FileIndexRoots, input: IndexSaveInput, now = new Date()): Promise<IndexSaveResult> {
  if (input.summary.trim().length === 0) throw new Error("The summary is empty.");
  const sources = resolveSources(roots, input.sources);
  const stamps = await Promise.all(sources.map(stampSource));
  const entryPath = resolveEntryPath(sources[0], stamps, input.name);
  const indexedAt = now.toISOString();
  const existingText = await fsPromises.readFile(entryPath, "utf8").catch(() => null);

  await fsPromises.mkdir(path.dirname(entryPath), { recursive: true });
  await fsPromises.writeFile(entryPath, serializeIndexEntry({
    indexedAt,
    sources: stamps,
    body: buildBody(existingText, input, indexedAt)
  }), "utf8");
  // The agent edits entries from the sandbox, so set permissions on the file as it is written.
  await ensureSandboxWritablePath({ rootPath: getWorkspaceMemoryDir(roots.workspaceRoot), targetPath: entryPath });
  return { entry_path: toSandboxPath(entryPath), mode: input.mode, sources: stamps };
}
