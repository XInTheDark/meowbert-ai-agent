import fsPromises from "node:fs/promises";
import path from "node:path";
import { getProjectContextNote } from "@meowbert/shared/project-context";

export interface ProjectContextPromptEntry {
  relativePath: string;
  absolutePath: string;
  kind: "file" | "directory";
  note: string | null;
}

export interface ProjectContextPromptData {
  rootPath: string;
  entries: ProjectContextPromptEntry[];
}

function toWebPath(value: string): string {
  return value.split(path.sep).join("/");
}

async function collectProjectContextEntries(input: {
  envRoot: string;
  currentPath: string;
  envPayload: Record<string, unknown>;
  excludedDirectories: Set<string>;
}): Promise<ProjectContextPromptEntry[]> {
  const directoryEntries = await fsPromises.readdir(input.currentPath, { withFileTypes: true });
  const sortedEntries = [...directoryEntries].sort((left, right) => left.name.localeCompare(right.name));
  const collected: ProjectContextPromptEntry[] = [];

  for (const directoryEntry of sortedEntries) {
    const absolutePath = path.join(input.currentPath, directoryEntry.name);
    if (input.excludedDirectories.has(absolutePath)) continue;
    const stats = await fsPromises.lstat(absolutePath).catch(() => null);
    if (!stats) {
      continue;
    }

    const relativePath = toWebPath(path.relative(input.envRoot, absolutePath));
    if (stats.isDirectory()) {
      collected.push({
        relativePath,
        absolutePath,
        kind: "directory",
        note: getProjectContextNote(input.envPayload, relativePath)
      });
      collected.push(...await collectProjectContextEntries({
        envRoot: input.envRoot,
        currentPath: absolutePath,
        envPayload: input.envPayload,
        excludedDirectories: input.excludedDirectories
      }));
      continue;
    }

    if (stats.isFile()) {
      collected.push({
        relativePath,
        absolutePath,
        kind: "file",
        note: getProjectContextNote(input.envPayload, relativePath)
      });
    }
  }

  return collected;
}

export async function loadProjectContextPromptData(
  envRoot: string,
  envPayload: Record<string, unknown>,
  linkedDirectories: Array<{ relativePath: string; absolutePath: string }> = []
): Promise<ProjectContextPromptData | null> {
  const rootPath = path.resolve(envRoot, "context");
  const folders = linkedDirectories.filter((value) => value.relativePath === "context" || value.relativePath.startsWith("context/"));
  const excludedDirectories = new Set(folders.map((value) => path.resolve(envRoot, value.relativePath)));
  const stats = excludedDirectories.has(rootPath) ? null : await fsPromises.lstat(rootPath).catch(() => null);
  const entries = stats?.isDirectory() ? await collectProjectContextEntries({
    envRoot,
    currentPath: rootPath,
    envPayload,
    excludedDirectories
  }) : [];
  entries.push(...folders.map((folder): ProjectContextPromptEntry => ({ ...folder, kind: "directory",
    note: getProjectContextNote(envPayload, folder.relativePath) })));
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  if (entries.length === 0) {
    return null;
  }

  return {
    rootPath,
    entries
  };
}
