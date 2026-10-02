import fsPromises from "node:fs/promises";
import { resolveRealPathWithinRoot } from "@meowbert/shared/server-security";

export interface ResolvedSelectedPath {
  relativePath: string;
  absolutePath: string;
  isDirectory: boolean;
}

// Resolves a multi-file selection inside a root for deletion or download. Each path must be an
// existing file or directory below the root, and entries already covered by a selected
// directory are dropped so they are not processed twice.
export async function resolveSelectedPathsWithinRoot(input: {
  rootPath: string;
  requestedPaths: string[];
  rootLabel: string;
  action: string;
}): Promise<ResolvedSelectedPath[]> {
  const uniquePaths = Array.from(new Set(input.requestedPaths.map((entry) => entry.trim()).filter((entry) => entry.length > 0)));

  const resolvedTargets = await Promise.all(
    uniquePaths.map(async (requestedPath) => {
      const target = await resolveRealPathWithinRoot(input.rootPath, requestedPath);
      if (!target.relativePath) {
        throw new Error(`Cannot ${input.action} the ${input.rootLabel} root`);
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
  const deduplicatedTargets: ResolvedSelectedPath[] = [];
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
