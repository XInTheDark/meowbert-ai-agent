import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  assertPathInsideRoot,
  createAvailableFilePath,
  sanitizeUploadFilename,
  toIsoTimestamp,
  toWebPath
} from "../../routes/environments/shared.js";

export class UploadTooLargeError extends Error {
  readonly statusCode = 413;
  readonly exposeMessage = true;

  constructor(limitBytes: number) {
    super(`File is larger than the ${Math.floor(limitBytes / (1024 * 1024))} MB upload limit.`);
    this.name = "UploadTooLargeError";
  }
}

export interface SavedUploadedFile {
  name: string;
  relativePath: string;
  sizeBytes: number;
  createdAt: string | null;
  modifiedAt: string | null;
}

// Multipart streams stop at the size limit and only flag `truncated`, so an oversized
// upload would otherwise be saved cut short and reported as a success.
export async function saveUploadedFile(input: {
  targetDirectory: { absolutePath: string; rootRealPath: string };
  filename: string | undefined;
  file: Readable & { truncated?: boolean };
  limitBytes: number;
}): Promise<{ absolutePath: string; file: SavedUploadedFile }> {
  const preferredPath = path.join(input.targetDirectory.absolutePath, sanitizeUploadFilename(input.filename));
  const destinationPath = path.resolve(await createAvailableFilePath(preferredPath));
  assertPathInsideRoot(input.targetDirectory.rootRealPath, destinationPath);

  try {
    await pipeline(input.file, fs.createWriteStream(destinationPath));
    if (input.file.truncated) {
      throw new UploadTooLargeError(input.limitBytes);
    }
  } catch (error) {
    await fsPromises.rm(destinationPath, { force: true });
    throw error;
  }

  const savedStats = await fsPromises.stat(destinationPath);
  return {
    absolutePath: destinationPath,
    file: {
      name: path.basename(destinationPath),
      relativePath: toWebPath(path.relative(input.targetDirectory.rootRealPath, destinationPath)),
      sizeBytes: savedStats.size,
      createdAt: toIsoTimestamp(savedStats.birthtime),
      modifiedAt: toIsoTimestamp(savedStats.mtime)
    }
  };
}
