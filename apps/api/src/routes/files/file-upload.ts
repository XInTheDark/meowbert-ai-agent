import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { ensureDirectoryWithinRoot } from "@meowbert/shared/server-security";
import {
  FILE_UPLOAD_LIMIT_BYTES,
  saveUploadedFile,
  UploadTooLargeError
} from "../../services/files/save-uploaded-file.js";
import {
  assertWorkspaceStorageAvailable,
  recordWorkspaceBytesAdded,
  resolveAvailableWorkspaceBytes,
  WorkspaceStorageLimitError,
  type WorkspaceStorageTarget
} from "../../services/workspaces/workspace-storage-allowance.js";
import type { fileUploadQuery } from "./file-route-schemas.js";

// Streams the request's single multipart file into a folder below rootPath. The stream is
// capped at whichever is smaller: the per-file limit or the workspace's remaining storage.
export async function receiveFileUpload(
  request: FastifyRequest,
  input: { rootPath: string; query: z.infer<typeof fileUploadQuery>; storage: WorkspaceStorageTarget }
) {
  const availableBytes = await resolveAvailableWorkspaceBytes(input.storage);
  assertWorkspaceStorageAvailable(availableBytes, 0);
  const storageBound = availableBytes !== null && availableBytes < FILE_UPLOAD_LIMIT_BYTES;
  const limitBytes = storageBound ? availableBytes : FILE_UPLOAD_LIMIT_BYTES;

  const targetDirectory = await ensureDirectoryWithinRoot({
    rootPath: input.rootPath,
    requestedPath: input.query.path,
    createDirectories: input.query.createDirectories
  });

  const upload = await request.file({
    limits: {
      files: 1,
      fileSize: limitBytes
    }
  });
  if (!upload) {
    throw new Error("No file was uploaded");
  }

  try {
    const saved = await saveUploadedFile({
      targetDirectory,
      filename: upload.filename,
      file: upload.file,
      limitBytes
    });
    recordWorkspaceBytesAdded(input.storage.workspaceId, saved.file.sizeBytes);
    return saved;
  } catch (error) {
    if (storageBound && error instanceof UploadTooLargeError) {
      throw new WorkspaceStorageLimitError(limitBytes);
    }
    throw error;
  }
}
