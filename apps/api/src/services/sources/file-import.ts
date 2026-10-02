import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { ensureSandboxWritablePath } from "@meowbert/shared";
import { ensureDirectoryWithinRoot } from "@meowbert/shared/server-security";
import { createAvailableFilePath, sanitizeUploadFilename, toIsoTimestamp } from "../files/file-paths.js";
import { downloadWorkspaceSourceFile } from "./source-operations.js";

export async function importWorkspaceSourceFileToEnvironment(input: {
  workspaceId: string;
  environmentRootPath: string;
  sourceId: string;
  itemId: string;
  destinationPath?: string | null;
  createDirectories?: boolean;
  onSaved?: (sizeBytes: number) => void;
}): Promise<{
  name: string;
  relativePath: string;
  sizeBytes: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
}> {
  const targetDirectory = await ensureDirectoryWithinRoot({
    rootPath: input.environmentRootPath,
    requestedPath: input.destinationPath ?? undefined,
    createDirectories: input.createDirectories
  });

  const download = await downloadWorkspaceSourceFile({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    itemId: input.itemId
  });
  if (!download.response.body) {
    throw new Error("Source download returned an empty response body.");
  }

  const safeFilename = sanitizeUploadFilename(download.fileName);
  const preferredPath = path.join(targetDirectory.absolutePath, safeFilename);
  const destinationPath = await createAvailableFilePath(preferredPath);

  await pipeline(
    Readable.fromWeb(download.response.body as unknown as NodeReadableStream),
    fs.createWriteStream(destinationPath)
  );
  const savedStats = await fsPromises.stat(destinationPath);
  try {
    input.onSaved?.(savedStats.size);
  } catch (error) {
    await fsPromises.rm(destinationPath, { force: true });
    throw error;
  }
  await ensureSandboxWritablePath({
    rootPath: input.environmentRootPath,
    targetPath: destinationPath
  });

  return {
    name: path.basename(destinationPath),
    relativePath: path.relative(targetDirectory.rootRealPath, destinationPath).split(path.sep).join("/"),
    sizeBytes: savedStats.size,
    createdAt: toIsoTimestamp(savedStats.birthtime),
    modifiedAt: toIsoTimestamp(savedStats.mtime)
  };
}
