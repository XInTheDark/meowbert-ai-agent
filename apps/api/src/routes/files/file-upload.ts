import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { resolveStorageDirectory } from "../../services/files/file-paths.js";
import { FILE_UPLOAD_LIMIT_BYTES, saveUploadedFile } from "../../services/files/save-uploaded-file.js";
import type { fileUploadQuery } from "./file-route-schemas.js";

// Streams the request's single multipart file into a folder below rootPath.
export async function receiveFileUpload(
  request: FastifyRequest,
  input: { rootPath: string; query: z.infer<typeof fileUploadQuery>; writable?: boolean }
) {
  const targetDirectory = await resolveStorageDirectory(input.rootPath, input.query.path);

  const upload = await request.file({
    limits: {
      files: 1,
      fileSize: FILE_UPLOAD_LIMIT_BYTES
    }
  });
  if (!upload) {
    throw new Error("No file was uploaded");
  }

  return saveUploadedFile({
    targetDirectory,
    filename: upload.filename,
    file: upload.file,
    limitBytes: FILE_UPLOAD_LIMIT_BYTES,
    writable: input.writable,
    createDirectories: input.query.createDirectories
  });
}
