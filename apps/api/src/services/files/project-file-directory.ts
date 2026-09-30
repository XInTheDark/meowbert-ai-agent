import { isProjectContextPath } from "@meowbert/shared";
import { ensureDirectoryWithinRoot, resolveRealPathWithinRoot, type ResolvedRootPath } from "@meowbert/shared/server-security";

export async function resolveProjectFileDirectory(
  rootPath: string,
  requestedPath?: string
): Promise<ResolvedRootPath> {
  const normalizedPath = requestedPath?.trim() ?? "";
  if (normalizedPath.length > 0 && isProjectContextPath(normalizedPath)) {
    return ensureDirectoryWithinRoot({
      rootPath,
      requestedPath: normalizedPath,
      createDirectories: true
    });
  }

  return resolveRealPathWithinRoot(rootPath, normalizedPath);
}
