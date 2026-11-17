import fsPromises from "node:fs/promises";
import path from "node:path";

export function toWebPath(input: string): string {
  return input.split(path.sep).join("/");
}

export function assertPathInsideRoot(rootPath: string, absolutePath: string): void {
  const normalizedRoot = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;
  if (absolutePath !== rootPath && !absolutePath.startsWith(normalizedRoot)) {
    throw new Error("Path is outside the storage root");
  }
}

export function toIsoTimestamp(value: Date | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return value.toISOString();
}

export function sanitizeUploadFilename(filename: string | undefined): string {
  const base = path.basename((filename ?? "").trim());
  if (!base || base === "." || base === "..") {
    return `upload-${Date.now()}.bin`;
  }
  return base;
}

// Only resolve the trusted root here. Descendant directories are opened/created
// relative to its descriptor by the storage helper, never by checked pathnames.
export async function resolveStorageDirectory(rootPath: string, requestedPath = ".") {
  const rootRealPath = await fsPromises.realpath(rootPath);
  const absolutePath = path.resolve(rootRealPath, requestedPath.trim() || ".");
  assertPathInsideRoot(rootRealPath, absolutePath);
  return { absolutePath, rootRealPath };
}

function* availableFilePathCandidates(targetPath: string): Generator<string> {
  const directory = path.dirname(targetPath);
  const extension = path.extname(targetPath);
  const base = path.basename(targetPath, extension);

  for (let index = 0; index < 200; index += 1) {
    const suffix = index === 0 ? "" : ` (${index})`;
    yield path.join(directory, `${base}${suffix}${extension}`);
  }
}

export async function createAvailableFilePath(targetPath: string): Promise<string> {
  for (const candidatePath of availableFilePathCandidates(targetPath)) {
    try {
      await fsPromises.access(candidatePath);
    } catch {
      return candidatePath;
    }
  }

  throw new Error("Too many files with the same name in this folder");
}
