import path from "node:path";

function normalizeRootPath(rootPath: string): string | null {
  const trimmed = rootPath.trim();
  if (!trimmed) {
    return null;
  }

  return path.resolve(trimmed);
}

function isNestedWithinRoot(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  if (!relative) {
    return true;
  }

  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function dedupeNestedWorkspaceStorageRoots(paths: string[]): string[] {
  const uniquePaths = Array.from(
    new Set(
      paths
        .map(normalizeRootPath)
        .filter((entry): entry is string => entry !== null)
    )
  );

  uniquePaths.sort((left, right) => {
    if (left.length !== right.length) {
      return left.length - right.length;
    }

    return left.localeCompare(right);
  });

  const deduped: string[] = [];
  for (const candidatePath of uniquePaths) {
    const alreadyCovered = deduped.some((existingPath) => isNestedWithinRoot(candidatePath, existingPath));
    if (!alreadyCovered) {
      deduped.push(candidatePath);
    }
  }

  return deduped;
}
