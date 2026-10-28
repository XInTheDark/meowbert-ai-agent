import type { Dirent } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { getProjectContextNotes, isProjectContextPath } from "@meowbert/shared/project-context";

export interface ProjectContextPromptEntry {
  relativePath: string;
  absolutePath: string;
  // "path" is a deeper path the user noted; its kind isn't looked up.
  kind: "file" | "directory" | "path";
  note: string | null;
}

export interface ProjectContextPromptData {
  rootPath: string;
  entries: ProjectContextPromptEntry[];
  omittedCount: number;
}

const TOP_LEVEL_ENTRY_LIMIT = 100;

// Context can sit on network storage, so a run reads one listing of `context/` itself and nothing
// below it. Deeper paths appear only when the user noted them or linked them as a folder; the agent
// lists further on its own when it needs to.
async function listTopLevel(rootPath: string, linkedPaths: Set<string>): Promise<Dirent[]> {
  if (linkedPaths.has(rootPath)) return [];
  const entries = await fsPromises.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => (entry.isFile() || entry.isDirectory()) && !linkedPaths.has(path.join(rootPath, entry.name)))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadProjectContextPromptData(
  envRoot: string,
  envPayload: Record<string, unknown>,
  linkedDirectories: Array<{ relativePath: string; absolutePath: string }> = []
): Promise<ProjectContextPromptData | null> {
  const rootPath = path.resolve(envRoot, "context");
  const notes = getProjectContextNotes(envPayload);
  const linked = linkedDirectories.filter((value) => isProjectContextPath(value.relativePath));
  const topLevel = await listTopLevel(rootPath, new Set(linked.map((value) => path.resolve(envRoot, value.relativePath))));

  const entries = new Map<string, ProjectContextPromptEntry>();
  for (const entry of topLevel.slice(0, TOP_LEVEL_ENTRY_LIMIT)) {
    const relativePath = `context/${entry.name}`;
    entries.set(relativePath, { relativePath, absolutePath: path.join(rootPath, entry.name),
      kind: entry.isDirectory() ? "directory" : "file", note: notes[relativePath] ?? null });
  }
  for (const folder of linked) {
    entries.set(folder.relativePath, { ...folder, kind: "directory", note: notes[folder.relativePath] ?? null });
  }
  for (const [relativePath, note] of Object.entries(notes)) {
    if (relativePath === "context" || !isProjectContextPath(relativePath) || entries.has(relativePath)) continue;
    entries.set(relativePath, { relativePath, absolutePath: path.resolve(envRoot, relativePath), kind: "path", note });
  }

  const omittedCount = Math.max(0, topLevel.length - TOP_LEVEL_ENTRY_LIMIT);
  if (entries.size === 0 && omittedCount === 0) return null;
  return {
    rootPath,
    entries: [...entries.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    omittedCount
  };
}
