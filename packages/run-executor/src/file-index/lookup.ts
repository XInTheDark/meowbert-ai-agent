import type { Dirent } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { toSandboxPath } from "@meowbert/shared/docker-sandbox";
import { parseIndexEntry } from "./entry-file.js";
import { checkSource, type SourceStatus } from "./freshness.js";
import {
  ancestorKeys,
  fileEntryPath,
  FILE_ENTRY_SUFFIX,
  FOLDER_ENTRY_FILENAME,
  folderEntryPath,
  GROUP_ENTRY_SUFFIX,
  indexFolderPath,
  isKeyWithin,
  joinKey,
  resolveIndexedPath,
  type FileIndexRoots,
  type IndexScope
} from "./locations.js";

// Finds the index entries for one path. It reads only index folders, which Meowbert owns, and
// stats each source of the entries it returns; it never lists the source tree.

const ENTRY_CONTENT_MAX_CHARS = 40_000;
const CHILD_ENTRY_LIMIT = 200;

type EntryCoverage = "this_path" | "group" | "parent_folder";

export interface IndexLookupEntry {
  entry_path: string;
  covers: EntryCoverage;
  status: "fresh" | "stale" | "unreadable";
  indexed_at: string | null;
  sources: Array<{ path: string; kind: "file" | "folder"; status: SourceStatus }>;
  content: string | null;
  content_truncated: boolean;
}

export interface IndexLookupChild {
  entry_path: string;
  kind: "file" | "folder" | "group";
  source_path: string | null;
}

export interface IndexLookupResult {
  path: string;
  scope: IndexScope["name"];
  kind: "file" | "folder" | "missing";
  entries: IndexLookupEntry[];
  child_entries: IndexLookupChild[];
  child_entries_truncated: boolean;
}

async function readEntryText(entryPath: string): Promise<string | null> {
  return fsPromises.readFile(entryPath, "utf8").catch(() => null);
}

async function listIndexFolder(scope: IndexScope, folderKey: string): Promise<Dirent[]> {
  const entries = await fsPromises.readdir(indexFolderPath(scope, folderKey), { withFileTypes: true }).catch(() => []);
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

async function statKind(absolutePath: string): Promise<IndexLookupResult["kind"]> {
  const stats = await fsPromises.stat(absolutePath).catch(() => null);
  if (!stats) return "missing";
  return stats.isDirectory() ? "folder" : "file";
}

async function describeEntry(input: {
  scope: IndexScope;
  entryPath: string;
  text: string;
  covers: EntryCoverage;
  includeContent: boolean;
}): Promise<IndexLookupEntry> {
  const entry = parseIndexEntry(input.text);
  const sources = await Promise.all((entry?.sources ?? []).map(async (source) => ({
    path: source.path,
    kind: source.kind,
    status: await checkSource(input.scope, source)
  })));
  const body = entry?.body ?? input.text;
  return {
    entry_path: toSandboxPath(input.entryPath),
    covers: input.covers,
    status: !entry ? "unreadable" : sources.every((source) => source.status === "fresh") ? "fresh" : "stale",
    indexed_at: entry?.indexedAt ?? null,
    sources,
    content: input.includeContent ? body.slice(0, ENTRY_CONTENT_MAX_CHARS) : null,
    content_truncated: input.includeContent && body.length > ENTRY_CONTENT_MAX_CHARS
  };
}

function groupCovers(text: string, key: string): boolean {
  return parseIndexEntry(text)?.sources.some((source) => (
    source.path === key || (source.kind === "folder" && isKeyWithin(source.path, key))
  )) ?? false;
}

async function findOwnEntries(scope: IndexScope, key: string, kind: IndexLookupResult["kind"]): Promise<IndexLookupEntry[]> {
  const candidates = kind === "file" ? [fileEntryPath(scope, key)]
    : kind === "folder" || key === "." ? [folderEntryPath(scope, key)]
      : [fileEntryPath(scope, key), folderEntryPath(scope, key)];
  const entries: IndexLookupEntry[] = [];
  for (const entryPath of candidates) {
    const text = await readEntryText(entryPath);
    if (text !== null) entries.push(await describeEntry({ scope, entryPath, text, covers: "this_path", includeContent: true }));
  }
  return entries;
}

// Folder summaries above the path (nearest first) and groups that include it.
async function findAncestorEntries(scope: IndexScope, key: string): Promise<{ groups: IndexLookupEntry[]; folders: IndexLookupEntry[] }> {
  const groups: IndexLookupEntry[] = [];
  const folders: IndexLookupEntry[] = [];
  for (const folderKey of ancestorKeys(key)) {
    for (const dirent of await listIndexFolder(scope, folderKey)) {
      const isFolderEntry = dirent.name === FOLDER_ENTRY_FILENAME;
      if (!dirent.isFile() || (!isFolderEntry && !dirent.name.endsWith(GROUP_ENTRY_SUFFIX))) continue;
      const entryPath = path.join(indexFolderPath(scope, folderKey), dirent.name);
      const text = await readEntryText(entryPath);
      if (text === null) continue;
      if (isFolderEntry) {
        folders.unshift(await describeEntry({ scope, entryPath, text, covers: "parent_folder", includeContent: false }));
      } else if (groupCovers(text, key)) {
        groups.push(await describeEntry({ scope, entryPath, text, covers: "group", includeContent: true }));
      }
    }
  }
  return { groups, folders };
}

// Entries filed inside a folder's index folder: groups that include the folder itself come back as
// entries, everything else as a child listing.
async function findFolderContents(scope: IndexScope, key: string): Promise<{ groups: IndexLookupEntry[]; children: IndexLookupChild[] }> {
  const groups: IndexLookupEntry[] = [];
  const children: IndexLookupChild[] = [];
  for (const dirent of await listIndexFolder(scope, key)) {
    const entryPath = path.join(indexFolderPath(scope, key), dirent.name);
    if (dirent.isDirectory()) {
      children.push({ entry_path: toSandboxPath(entryPath), kind: "folder", source_path: joinKey(key, dirent.name) });
    } else if (dirent.isFile() && dirent.name.endsWith(GROUP_ENTRY_SUFFIX)) {
      const text = await readEntryText(entryPath);
      if (text !== null && groupCovers(text, key)) {
        groups.push(await describeEntry({ scope, entryPath, text, covers: "group", includeContent: true }));
      } else {
        children.push({ entry_path: toSandboxPath(entryPath), kind: "group", source_path: null });
      }
    } else if (dirent.isFile() && dirent.name !== FOLDER_ENTRY_FILENAME && dirent.name.endsWith(FILE_ENTRY_SUFFIX)) {
      const sourceName = dirent.name.slice(0, -FILE_ENTRY_SUFFIX.length);
      children.push({ entry_path: toSandboxPath(entryPath), kind: "file", source_path: joinKey(key, sourceName) });
    }
  }
  return { groups, children };
}

export async function lookupIndex(roots: FileIndexRoots, requestedPath: string): Promise<IndexLookupResult> {
  const { scope, key, absolutePath } = resolveIndexedPath(roots, requestedPath);
  const kind = await statKind(absolutePath);
  const own = await findOwnEntries(scope, key, kind);
  const ancestors = await findAncestorEntries(scope, key);
  const contents = kind === "file" ? { groups: [], children: [] } : await findFolderContents(scope, key);
  return {
    path: key,
    scope: scope.name,
    kind,
    entries: [...own, ...ancestors.groups, ...contents.groups, ...ancestors.folders],
    child_entries: contents.children.slice(0, CHILD_ENTRY_LIMIT),
    child_entries_truncated: contents.children.length > CHILD_ENTRY_LIMIT
  };
}
