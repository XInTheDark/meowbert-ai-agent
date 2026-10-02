import fsPromises from "node:fs/promises";
import path from "node:path";
import { ensureSandboxWritablePath } from "@meowbert/shared";
import { ensureDirectoryWithinRoot } from "@meowbert/shared/server-security";
import {
  assertPathInsideRoot,
  createAvailableFilePath,
  sanitizeUploadFilename,
  toIsoTimestamp,
  toWebPath
} from "./file-paths.js";

export async function createTextFileWithinRoot(input: {
  rootPath: string;
  requestedDirectoryPath?: string;
  name: string;
  content: string;
}): Promise<{
  name: string;
  relativePath: string;
  sizeBytes: number;
  createdAt: string | null;
  modifiedAt: string | null;
}> {
  const targetDirectory = await ensureDirectoryWithinRoot({
    rootPath: input.rootPath,
    requestedPath: input.requestedDirectoryPath,
    createDirectories: true
  });

  const safeFilename = sanitizeUploadFilename(input.name);
  const preferredPath = path.join(targetDirectory.absolutePath, safeFilename);
  let destinationPath = await createAvailableFilePath(preferredPath);
  destinationPath = path.resolve(destinationPath);
  assertPathInsideRoot(targetDirectory.rootRealPath, destinationPath);
  const readableRootPath = await fsPromises.realpath(input.rootPath).catch(() => path.resolve(input.rootPath));

  await fsPromises.writeFile(destinationPath, input.content, "utf8");
  await ensureSandboxWritablePath({
    rootPath: readableRootPath,
    targetPath: destinationPath
  });
  const savedStats = await fsPromises.stat(destinationPath);

  return {
    name: path.basename(destinationPath),
    relativePath: toWebPath(path.relative(targetDirectory.rootRealPath, destinationPath)),
    sizeBytes: savedStats.size,
    createdAt: toIsoTimestamp(savedStats.birthtime),
    modifiedAt: toIsoTimestamp(savedStats.mtime)
  };
}
