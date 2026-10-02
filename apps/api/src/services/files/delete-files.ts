import fsPromises from "node:fs/promises";
import type { ResolvedSelectedPath } from "./selected-paths.js";

export interface DeletedFilesResult {
  deletedCount: number;
  deletedPaths: string[];
}

export async function deleteSelectedPaths(targets: ResolvedSelectedPath[]): Promise<DeletedFilesResult> {
  const deletedPaths: string[] = [];

  for (const target of targets) {
    await fsPromises.rm(target.absolutePath, {
      recursive: true,
      force: false
    });
    deletedPaths.push(target.relativePath);
  }

  return {
    deletedCount: deletedPaths.length,
    deletedPaths
  };
}
