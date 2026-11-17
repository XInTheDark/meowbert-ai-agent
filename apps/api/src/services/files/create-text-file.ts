import { Readable } from "node:stream";
import { resolveStorageDirectory } from "./file-paths.js";
import { saveUploadedFile } from "./save-uploaded-file.js";

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
  const saved = await saveUploadedFile({
    targetDirectory: await resolveStorageDirectory(input.rootPath, input.requestedDirectoryPath),
    filename: input.name,
    file: Readable.from([Buffer.from(input.content, "utf8")]),
    limitBytes: Number.MAX_SAFE_INTEGER,
    writable: true,
    createDirectories: true
  });
  const { name, relativePath, sizeBytes, createdAt, modifiedAt } = saved.file;
  return {
    name, relativePath, sizeBytes, createdAt, modifiedAt
  };
}
