import fsPromises from "node:fs/promises";
import { resolveRealPathWithinRoot } from "@meowbert/shared/server-security";

export interface ResolvedDeletionTarget {
  relativePath: string;
  absolutePath: string;
  isDirectory: boolean;
}

export interface DeleteResolvedTargetsResult {
  deletedCount: number;
  deletedPaths: string[];
}

export async function resolveDeletionTargetsWithinRoot(input: {
  rootPath: string;
  requestedPaths: string[];
  rootLabel: string;
}): Promise<ResolvedDeletionTarget[]> {
  const uniquePaths = Array.from(new Set(input.requestedPaths.map((entry) => entry.trim()).filter((entry) => entry.length > 0)));

  const resolvedTargets = await Promise.all(
    uniquePaths.map(async (requestedPath) => {
      const target = await resolveRealPathWithinRoot(input.rootPath, requestedPath);
      if (!target.relativePath) {
        throw new Error(`Cannot delete the ${input.rootLabel} root`);
      }

      const stats = await fsPromises.lstat(target.absolutePath).catch(() => null);
      if (!stats) {
        throw new Error(`Path not found: ${requestedPath}`);
      }
      if (!stats.isFile() && !stats.isDirectory()) {
        throw new Error(`Unsupported path type: ${requestedPath}`);
      }

      return {
        relativePath: target.relativePath,
        absolutePath: target.absolutePath,
        isDirectory: stats.isDirectory()
      };
    })
  );

  const sortedTargets = [...resolvedTargets].sort((left, right) => left.relativePath.length - right.relativePath.length);
  const deduplicatedTargets: ResolvedDeletionTarget[] = [];
  for (const target of sortedTargets) {
    const alreadyCoveredByDirectory = deduplicatedTargets.some(
      (existing) =>
        existing.isDirectory
        && (target.relativePath === existing.relativePath || target.relativePath.startsWith(`${existing.relativePath}/`))
    );

    if (!alreadyCoveredByDirectory) {
      deduplicatedTargets.push(target);
    }
  }

  return deduplicatedTargets;
}

export async function deleteResolvedTargets(targets: ResolvedDeletionTarget[]): Promise<DeleteResolvedTargetsResult> {
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
