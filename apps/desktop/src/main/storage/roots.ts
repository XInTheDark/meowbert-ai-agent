import fs from "node:fs/promises";
import path from "node:path";
import { isWithinPath, verifyStorageRoot, type StorageProbeResult } from "@meowbert/shared";
import { resolveDevicePath } from "../workspace-files/roots";

export function resolveMountedStoragePath(mountPath: string, relativePath: string): string {
  const root = path.resolve(mountPath);
  const resolved = path.resolve(root, relativePath);
  if (path.isAbsolute(relativePath) || !isWithinPath(root, resolved)) throw new Error("The storage path escapes the selected mount.");
  return resolved;
}
export async function resolveVerifiedStoragePath(
  mountPath: string, relativePath: string | undefined, options: { createDirectory?: boolean } = {}
): Promise<string> {
  if (relativePath === undefined) throw new Error("The server did not provide a storage-relative root.");
  const root = await fs.realpath(mountPath);
  const candidate = resolveMountedStoragePath(root, relativePath);
  let resolved: string;
  try { resolved = await fs.realpath(candidate); }
  catch (error) {
    if (!options.createDirectory || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Sync clients may omit empty project directories. Check every named ancestor before mkdir.
    const directory = await resolveDevicePath(root, relativePath);
    await fs.mkdir(directory, { recursive: true });
    resolved = await fs.realpath(candidate);
  }
  if (!isWithinPath(root, resolved)) throw new Error("The storage symlink escapes the selected mount.");
  return resolved;
}
export async function verifyMountedStorage(input: {
  mountPath: string; backendId: string; deviceId: string; installId?: string;
}): Promise<StorageProbeResult> {
  return verifyStorageRoot({ root: await fs.realpath(input.mountPath), backendId: input.backendId, installId: input.installId, deviceId: input.deviceId });
}
