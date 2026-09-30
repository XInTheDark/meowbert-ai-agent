import path from "node:path";

interface BatchDownloadArchivePathInput {
  currentDirectory: string;
  targetRelativePath: string;
}

export function buildBatchDownloadArchivePath(input: BatchDownloadArchivePathInput): string {
  if (input.currentDirectory.length > 0) {
    const currentDirectoryPrefix = `${input.currentDirectory}/`;
    const isInsideCurrentDirectory =
      input.targetRelativePath === input.currentDirectory || input.targetRelativePath.startsWith(currentDirectoryPrefix);

    if (!isInsideCurrentDirectory) {
      throw new Error(`Selected path is outside the current directory: ${input.targetRelativePath}`);
    }
  }

  const archiveBasePath = input.currentDirectory.length > 0
    ? path.posix.dirname(input.currentDirectory)
    : "";
  const archivePath = path.posix.relative(archiveBasePath === "." ? "" : archiveBasePath, input.targetRelativePath);

  if (
    archivePath.length === 0
    || archivePath === "."
    || archivePath.startsWith("../")
    || archivePath.includes("/../")
  ) {
    throw new Error(`Failed to build archive path for: ${input.targetRelativePath}`);
  }

  return archivePath;
}
