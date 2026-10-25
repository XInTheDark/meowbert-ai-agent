import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isWithinPath } from "@meowbert/shared";

const MARKER = ".meowbert-workspace.json";
export async function initializeDeviceWorkspace(root: string, workspaceId: string): Promise<string> {
  const canonical = await fs.realpath(root);
  try {
    await fs.writeFile(path.join(canonical, MARKER), JSON.stringify({ version: 1, workspaceId }) + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  await verifyDeviceWorkspace(canonical, workspaceId);
  await fs.mkdir(path.join(canonical, "projects"), { recursive: true });
  await fs.mkdir(path.join(canonical, ".memory"), { recursive: true });
  return canonical;
}

export async function verifyDeviceWorkspace(root: string, workspaceId: string): Promise<string> {
  const canonical = await fs.realpath(root);
  const marker = JSON.parse(await fs.readFile(path.join(canonical, MARKER), "utf8"));
  if (marker.version !== 1 || marker.workspaceId !== workspaceId) throw new Error("The selected folder belongs to a different workspace.");
  const probe = path.join(canonical, ".meowbert-probe-" + randomUUID());
  await fs.writeFile(probe, "probe", { flag: "wx" }); await fs.unlink(probe);
  return canonical;
}

/** Validate every component, including existing symlinks when creating a new file. */
export async function resolveDevicePath(root: string, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || /^[a-z]:|^\\|(^|[\\/])\.\.([\\/]|$)/i.test(relative)) throw new Error("Path escapes the workspace folder.");
  const canonical = await fs.realpath(root);
  let current = canonical;
  for (const part of relative.split(/[\\/]/).filter((part) => part && part !== ".")) {
    current = path.join(current, part);
    try { current = await fs.realpath(current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!isWithinPath(canonical, current)) throw new Error("A symlink escapes the workspace folder.");
  }
  return current;
}
