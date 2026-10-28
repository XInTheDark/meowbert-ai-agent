import path from "node:path";
import { isWithinPath } from "@meowbert/shared";
import { fromSandboxPath } from "@meowbert/shared/docker-sandbox";
import { getProjectMemoryDir, getWorkspaceMemoryDir } from "../memory/main-files.js";

// Where index entries live. The index mirrors the source tree: a path inside the project is indexed
// in project memory under its project-relative path, any other workspace path in workspace memory
// under its workspace-relative path. Mirroring lets a lookup find entries by listing a few index
// folders instead of searching.
//
//   file   context/specs/api.yaml   -> index/context/specs/api.yaml.md
//   folder context/specs            -> index/context/specs/__folder__.md
//   group  (named "auth flow")      -> index/<deepest folder holding all sources>/auth-flow.group.md

export const FOLDER_ENTRY_FILENAME = "__folder__.md";
export const GROUP_ENTRY_SUFFIX = ".group.md";
export const FILE_ENTRY_SUFFIX = ".md";
const INDEX_DIRNAME = "index";
const ROOT_KEY = ".";

export interface FileIndexRoots {
  workspaceRoot: string;
  envRoot: string;
  projectId: string;
}

export interface IndexScope {
  name: "project" | "workspace";
  root: string;
  indexDir: string;
}

export interface IndexedPath {
  scope: IndexScope;
  // Posix path relative to the scope root; "." for the root itself.
  key: string;
  absolutePath: string;
}

function toKey(root: string, absolutePath: string): string {
  const relative = path.relative(root, absolutePath).split(path.sep).join("/");
  return relative.length > 0 ? relative : ROOT_KEY;
}

function resolveScope(roots: FileIndexRoots, absolutePath: string): IndexScope {
  const memoryDir = getWorkspaceMemoryDir(roots.workspaceRoot);
  if (isWithinPath(memoryDir, absolutePath)) {
    throw new Error("Memory files are not indexed. Read or search them directly.");
  }
  const envRoot = path.resolve(roots.envRoot);
  if (isWithinPath(envRoot, absolutePath)) {
    return { name: "project", root: envRoot, indexDir: path.resolve(getProjectMemoryDir(memoryDir, roots.projectId), INDEX_DIRNAME) };
  }
  const workspaceRoot = path.resolve(roots.workspaceRoot);
  if (isWithinPath(workspaceRoot, absolutePath)) {
    return { name: "workspace", root: workspaceRoot, indexDir: path.resolve(memoryDir, INDEX_DIRNAME) };
  }
  throw new Error("Only paths inside the workspace can be indexed.");
}

// Relative paths are read from the project root, so `context/specs` works as written.
export function resolveIndexedPath(roots: FileIndexRoots, requestedPath: string): IndexedPath {
  const requested = fromSandboxPath(requestedPath.trim());
  if (requested.length === 0) throw new Error("A path is required.");
  const absolutePath = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(roots.envRoot, requested);
  const scope = resolveScope(roots, absolutePath);
  return { scope, key: toKey(scope.root, absolutePath), absolutePath };
}

export function sourceAbsolutePath(scope: IndexScope, key: string): string {
  return path.resolve(scope.root, ...key.split("/"));
}

export function indexFolderPath(scope: IndexScope, folderKey: string): string {
  return path.resolve(scope.indexDir, ...folderKey.split("/"));
}

export function fileEntryPath(scope: IndexScope, key: string): string {
  return indexFolderPath(scope, key) + FILE_ENTRY_SUFFIX;
}

export function folderEntryPath(scope: IndexScope, key: string): string {
  return path.join(indexFolderPath(scope, key), FOLDER_ENTRY_FILENAME);
}

function toGroupFilename(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80);
  if (slug.length === 0) throw new Error("A group entry needs a name made of letters or numbers.");
  return slug + GROUP_ENTRY_SUFFIX;
}

export function groupEntryPath(scope: IndexScope, folderKey: string, name: string): string {
  return path.join(indexFolderPath(scope, folderKey), toGroupFilename(name));
}

export function joinKey(folderKey: string, name: string): string {
  return folderKey === ROOT_KEY ? name : `${folderKey}/${name}`;
}

function parentKey(key: string): string {
  const index = key.lastIndexOf("/");
  return index < 0 ? ROOT_KEY : key.slice(0, index);
}

// The folders above a key, from the scope root down to its parent.
export function ancestorKeys(key: string): string[] {
  if (key === ROOT_KEY) return [];
  const parts = key.split("/");
  return [ROOT_KEY, ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"))];
}

export function isKeyWithin(folderKey: string, key: string): boolean {
  return folderKey === ROOT_KEY || key === folderKey || key.startsWith(`${folderKey}/`);
}

// The deepest folder that holds every source; a folder source counts as holding itself.
export function commonFolderKey(sources: Array<{ path: string; kind: "file" | "folder" }>): string {
  const folders = sources.map((source) => (source.kind === "folder" ? source.path : parentKey(source.path)));
  const split = folders.map((folder) => (folder === ROOT_KEY ? [] : folder.split("/")));
  const shared: string[] = [];
  for (let index = 0; index < Math.min(...split.map((parts) => parts.length)); index += 1) {
    const part = split[0][index];
    if (!split.every((parts) => parts[index] === part)) break;
    shared.push(part);
  }
  return shared.length > 0 ? shared.join("/") : ROOT_KEY;
}
