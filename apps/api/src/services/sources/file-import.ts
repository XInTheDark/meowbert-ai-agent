import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { resolveStorageDirectory } from "../files/file-paths.js";
import { saveUploadedFile } from "../files/save-uploaded-file.js";
import { downloadWorkspaceSourceFile } from "./source-operations.js";

export async function importWorkspaceSourceFileToEnvironment(input: {
  workspaceId: string;
  environmentRootPath: string;
  sourceId: string;
  itemId: string;
  destinationPath?: string | null;
  createDirectories?: boolean;
}): Promise<{
  name: string;
  relativePath: string;
  sizeBytes: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
}> {
  const targetDirectory = await resolveStorageDirectory(input.environmentRootPath, input.destinationPath ?? undefined);

  const download = await downloadWorkspaceSourceFile({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    itemId: input.itemId
  });
  if (!download.response.body) {
    throw new Error("Source download returned an empty response body.");
  }

  const saved = await saveUploadedFile({
    targetDirectory,
    filename: download.fileName,
    file: Readable.fromWeb(download.response.body as unknown as NodeReadableStream),
    limitBytes: Number.MAX_SAFE_INTEGER,
    writable: true,
    createDirectories: input.createDirectories
  });
  const { name, relativePath, sizeBytes, createdAt, modifiedAt } = saved.file;
  return {
    name, relativePath, sizeBytes, createdAt, modifiedAt
  };
}
