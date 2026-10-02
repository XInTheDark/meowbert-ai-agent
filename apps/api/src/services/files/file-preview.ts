import fsPromises from "node:fs/promises";
import { resolveRealPathWithinRoot } from "@meowbert/shared/server-security";

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
  const fileStats = await fsPromises.lstat(target.absolutePath).catch(() => null);
  if (!fileStats || !fileStats.isFile()) {
    throw new Error("File not found");
  }

  const previewBytes = Math.min(fileStats.size, FILE_PREVIEW_LIMIT_BYTES);
  const previewBuffer = Buffer.alloc(previewBytes);
  const fileHandle = await fsPromises.open(target.absolutePath, "r");
  try {
    if (previewBytes > 0) {
      await fileHandle.read(previewBuffer, 0, previewBytes, 0);
    }
  } finally {
    await fileHandle.close();
  }

  const isBinary = previewBuffer.includes(0);
  return {
    relativePath: target.relativePath,
    sizeBytes: fileStats.size,
    truncated: fileStats.size > previewBytes,
    encoding: isBinary ? "binary" : "utf-8",
    text: isBinary ? null : previewBuffer.toString("utf8")
  };
}
