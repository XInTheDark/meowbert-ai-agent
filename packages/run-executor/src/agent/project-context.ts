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
}): Promise<ProjectContextPromptEntry[]> {
  const directoryEntries = await fsPromises.readdir(input.currentPath, { withFileTypes: true });
  const sortedEntries = [...directoryEntries].sort((left, right) => left.name.localeCompare(right.name));
  const collected: ProjectContextPromptEntry[] = [];

  for (const directoryEntry of sortedEntries) {
    const absolutePath = path.join(input.currentPath, directoryEntry.name);
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
        envPayload: input.envPayload
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
  envPayload: Record<string, unknown>
): Promise<ProjectContextPromptData | null> {
  const rootPath = path.resolve(envRoot, "context");
  const stats = await fsPromises.lstat(rootPath).catch(() => null);
  if (!stats?.isDirectory()) {
    return null;
  }

  const entries = await collectProjectContextEntries({
    envRoot,
    currentPath: rootPath,
    envPayload
  });
  if (entries.length === 0) {
    return null;
  }

  return {
    rootPath,
    entries
  };
}
