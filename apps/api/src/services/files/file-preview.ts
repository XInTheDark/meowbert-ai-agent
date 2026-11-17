import { resolveRealPathWithinRoot } from "@meowbert/shared/server-security";
import { runStorageFileOperation } from "./storage-file-operation.js";

const FILE_PREVIEW_LIMIT_BYTES = 300_000;

export interface FilePreview {
  relativePath: string;
  sizeBytes: number;
  truncated: boolean;
  encoding: "binary" | "utf-8";
  text: string | null;
}

// Reads the start of a file for the browser's preview pane; files with NUL bytes count as binary.
export async function readFilePreview(rootPath: string, requestedPath: string): Promise<FilePreview> {
  const target = await resolveRealPathWithinRoot(rootPath, requestedPath);
  const opened = await runStorageFileOperation<{ sizeBytes: number; data: string }>({
    operation: "preview", rootPath: target.rootRealPath, relativePath: target.relativePath,
    limitBytes: FILE_PREVIEW_LIMIT_BYTES
  });
  const previewBuffer = Buffer.from(opened.data, "base64");

  const isBinary = previewBuffer.includes(0);
  return {
    relativePath: target.relativePath,
    sizeBytes: opened.sizeBytes,
    truncated: opened.sizeBytes > previewBuffer.length,
    encoding: isBinary ? "binary" : "utf-8",
    text: isBinary ? null : previewBuffer.toString("utf8")
  };
}
