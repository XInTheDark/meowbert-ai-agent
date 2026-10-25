import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { WorkspaceFilesRequest } from "@meowbert/shared";
import { resolveDevicePath } from "./roots";

const relative = (root: string, file: string) => path.relative(root, file).split(path.sep).join("/");
async function describe(root: string, file: string) {
  const stat = await fs.lstat(file);
  return { name: path.basename(file), relativePath: relative(root, file), kind: stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "file",
    sizeBytes: stat.isFile() ? stat.size : null, createdAt: stat.birthtime.toISOString(), modifiedAt: stat.mtime.toISOString() };
}

export async function listDeviceDirectory(root: string, requested: string) {
  const dir = await resolveDevicePath(root, requested);
  const names = await fs.readdir(dir);
  const items = await Promise.all(names.map((name) => describe(root, path.join(dir, name))));
  items.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name));
  const cwd = relative(root, dir);
  return { cwd, parentPath: cwd ? relative(root, path.dirname(dir)) : null, items };
}

export async function previewDeviceFile(root: string, requested: string) {
  const file = await resolveDevicePath(root, requested); const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error("File not found");
  const handle = await fs.open(file, "r"); const buffer = Buffer.alloc(Math.min(stat.size, 300_000));
  try { await handle.read(buffer, 0, buffer.length, 0); } finally { await handle.close(); }
  const binary = buffer.includes(0);
  return { relativePath: relative(root, file), sizeBytes: stat.size, truncated: stat.size > buffer.length,
    encoding: binary ? "binary" : "utf-8", text: binary ? null : buffer.toString("utf8") };
}

export async function writeDeviceFile(root: string, request: WorkspaceFilesRequest, directory: string) {
  const body = request.body as { name?: string; content?: string } | undefined;
  const name = request.file?.name ?? body?.name ?? "";
  if (name === ".meowbert-workspace.json") throw new Error("The workspace marker cannot be changed.");
  if (!name || name !== path.basename(name) || /[\\/]/.test(name) || name === "." || name === "..") throw new Error("Invalid filename.");
  const dir = await resolveDevicePath(root, directory);
  await fs.mkdir(dir, { recursive: true });
  const file = await resolveDevicePath(root, path.join(directory, name));
  const data = request.file ? Buffer.from(request.file.dataBase64, "base64") : Buffer.from(body?.content ?? "", "utf8");
  await fs.writeFile(file, data);
  return { ...await describe(root, file), sha256: createHash("sha256").update(data).digest("hex") };
}

export async function deleteDeviceFiles(root: string, requestedPaths: string[]) {
  const targets = await Promise.all(requestedPaths.map((requested) => resolveDevicePath(root, requested)));
  if (targets.some((target) => target === root || path.basename(target) === ".meowbert-workspace.json")) throw new Error("The workspace root and marker cannot be deleted.");
  for (const target of targets) await fs.rm(target, { recursive: true, force: true });
  return { deletedCount: targets.length, deletedPaths: targets.map((target) => relative(root, target)), storage: null };
}
