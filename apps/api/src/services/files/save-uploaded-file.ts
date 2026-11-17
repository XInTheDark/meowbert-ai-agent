import path from "node:path";
import type { Readable } from "node:stream";
import {
  assertPathInsideRoot,
  sanitizeUploadFilename,
  toWebPath
} from "./file-paths.js";
import { runStorageFileOperation } from "./storage-file-operation.js";

export const FILE_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;

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
  sha256: string;
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
  writable?: boolean;
  createDirectories?: boolean;
}): Promise<{ absolutePath: string; file: SavedUploadedFile }> {
  const preferredPath = path.resolve(input.targetDirectory.absolutePath, sanitizeUploadFilename(input.filename));
  assertPathInsideRoot(input.targetDirectory.rootRealPath, preferredPath);
  let saved: Omit<SavedUploadedFile, "relativePath">;
  try {
    saved = await runStorageFileOperation({
      operation: "upload", rootPath: input.targetDirectory.rootRealPath,
      relativePath: toWebPath(path.relative(input.targetDirectory.rootRealPath, preferredPath)),
      limitBytes: input.limitBytes, writable: input.writable, createDirectories: input.createDirectories
    }, input.file);
  } catch (error) {
    if (input.file.truncated || (error instanceof Error && error.message === "UPLOAD_TOO_LARGE")) {
      throw new UploadTooLargeError(input.limitBytes);
    }
    throw error;
  }
  const destinationPath = path.join(input.targetDirectory.absolutePath, saved.name);
  return {
    absolutePath: destinationPath,
    file: {
      ...saved,
      relativePath: toWebPath(path.relative(input.targetDirectory.rootRealPath, destinationPath))
    }
  };
}
