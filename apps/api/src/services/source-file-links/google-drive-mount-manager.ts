import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { resolveWorkspaceSourceAccess } from "../sources/source-access.js";
import type { SourceFileLink } from "./types.js";
import { waitForGoogleDriveMount } from "./google-drive-mount-startup.js";
import { SourceFileLinkActionError } from "./provider-errors.js";

const execFile = promisify(execFileCallback);
const STOP_TIMEOUT_MS = 15_000;
const MAX_STACKED_MOUNTS = 16;
const mounts = new Map<string, GoogleDriveMountHandle>();
const accessLocks = new Map<string, Promise<unknown>>();
const mountLocks = new Map<string, Promise<unknown>>();

interface GoogleDriveMountHandle {
  linkId: string;
  mountPoint: string;
  process: ChildProcess;
  configDir: string;
  references: Set<string>;
  stopPromise: Promise<void> | null;
  unlinkRequested: boolean;
}

function tokenJson(access: Awaited<ReturnType<typeof resolveWorkspaceSourceAccess>>): string {
  const tokens = access.connection.tokens;
  return JSON.stringify({
    access_token: tokens.accessToken,
    token_type: tokens.tokenType ?? "Bearer",
    refresh_token: tokens.refreshToken,
    expiry: tokens.expiresAt
  });
}

async function withAccessLock<T>(workspaceId: string, run: () => Promise<T>): Promise<T> {
  const previous = accessLocks.get(workspaceId) ?? Promise.resolve();
  const current = previous.then(run, run);
  accessLocks.set(workspaceId, current);
  try {
    return await current;
  } finally {
    if (accessLocks.get(workspaceId) === current) accessLocks.delete(workspaceId);
  }
}

async function withMountLock<T>(linkId: string, run: () => Promise<T>): Promise<T> {
  const previous = mountLocks.get(linkId) ?? Promise.resolve();
  const current = previous.then(run, run);
  mountLocks.set(linkId, current);
  try {
    return await current;
  } finally {
    if (mountLocks.get(linkId) === current) mountLocks.delete(linkId);
  }
}

async function lazyUnmount(mountPoint: string): Promise<void> {
  try { await execFile("fusermount3", ["-u", "-z", mountPoint], { timeout: 2_000, killSignal: "SIGKILL" }); } catch { /* already gone */ }
}

// mountinfo escapes spaces and other special characters as octal (\040).
function decodeMountInfoPath(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

async function countMountsAt(mountPoint: string): Promise<number | null> {
  try {
    const mountInfo = await fs.readFile("/proc/self/mountinfo", "utf8");
    return mountInfo.split("\n").filter((line) => decodeMountInfoPath(line.split(" ")[4] ?? "") === mountPoint).length;
  } catch {
    return null;
  }
}

// Dead mounts can stack at one path across API restarts, and rclone refuses a path that is still
// listed as mounted. Detach every layer, reading procfs rather than touching the mount itself.
async function detachMountStack(mountPoint: string): Promise<void> {
  const layers = Math.min((await countMountsAt(mountPoint)) ?? 1, MAX_STACKED_MOUNTS);
  for (let layer = 0; layer < layers; layer += 1) await lazyUnmount(mountPoint);
}

function unsyncedCopyPath(mountPoint: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "-");
  return `${mountPoint} (unsynced ${stamp})`;
}

// rclone refuses a non-empty mount point. Files land there when something wrote to the folder while
// it was unmounted (e.g. a running task across an API restart), so move them aside where the user can
// see them instead of hiding them under the mount.
async function prepareEmptyMountPoint(mountPoint: string): Promise<void> {
  try {
    await fs.rmdir(mountPoint);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTEMPTY" || code === "EEXIST") {
      const copyPath = unsyncedCopyPath(mountPoint);
      await fs.rename(mountPoint, copyPath);
      console.warn(`[google-drive] moved local files out of the live folder mount point to ${copyPath}`);
    } else if (code !== "ENOENT") {
      throw error;
    }
  }
  await fs.mkdir(mountPoint, { recursive: true });
}

function stopMount(handle: GoogleDriveMountHandle): Promise<void> {
  handle.stopPromise ??= Promise.resolve().then(() => finishStoppingMount(handle));
  return handle.stopPromise;
}

async function finishStoppingMount(handle: GoogleDriveMountHandle): Promise<void> {
  if (handle.process.exitCode === null && handle.process.signalCode === null) {
    handle.process.kill("SIGINT");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, STOP_TIMEOUT_MS);
      handle.process.once("exit", () => { clearTimeout(timer); resolve(undefined); });
    });
  }
  if (handle.process.exitCode === null && handle.process.signalCode === null) {
    handle.process.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      handle.process.once("exit", () => { clearTimeout(timer); resolve(undefined); });
    });
  }
  await lazyUnmount(handle.mountPoint);
  await fs.rm(handle.configDir, { recursive: true, force: true }).catch(() => undefined);
  mounts.delete(handle.linkId);
}

export async function acquireGoogleDriveFolderMount(input: {
  link: SourceFileLink;
  consumerId: string;
  mountPoint: string;
}): Promise<string> {
  return withMountLock(input.link.id, async () => {
    const existing = mounts.get(input.link.id);
    if (existing && !existing.stopPromise) {
      existing.references.add(input.consumerId);
      return existing.mountPoint;
    }
    if (existing) await stopMount(existing);

    const access = await withAccessLock(input.link.workspaceId, () => resolveWorkspaceSourceAccess({
      workspaceId: input.link.workspaceId,
      provider: "google-drive"
    }));
    const mountPoint = path.resolve(input.mountPoint);
    // A mount left behind by a previous API process (e.g. after a restart) is dead and makes any
    // stat of the path fail with ENOTCONN, so detach it before touching the directory.
    await detachMountStack(mountPoint);
    await prepareEmptyMountPoint(mountPoint);
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-google-drive-"));
    const configPath = path.join(configDir, "rclone.conf");
    let child: ChildProcess;
    try {
      await fs.writeFile(configPath, `[google-drive]\ntype = drive\nclient_id = ${access.settings.clientId}\nclient_secret = ${access.settings.clientSecret}\ntoken = ${tokenJson(access)}\nroot_folder_id = ${input.link.remoteItemId}\n`, { mode: 0o600 });
      child = spawn("rclone", ["--config", configPath, "mount", "google-drive:", mountPoint,
        "--vfs-cache-mode", "full", "--vfs-write-back", "1s", "--vfs-cache-max-size", "10G",
        "--vfs-fast-fingerprint", "--dir-cache-time", "30m", "--drive-pacer-min-sleep", "100ms",
        "--drive-export-formats", "url", "--allow-other", "--timeout", "10s", "--contimeout", "5s",
        "--low-level-retries", "2", "--retries", "1"], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      await fs.rm(configDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    const handle: GoogleDriveMountHandle = { linkId: input.link.id, mountPoint, process: child, configDir, references: new Set([input.consumerId]), stopPromise: null, unlinkRequested: false };
    mounts.set(input.link.id, handle);
    child.once("exit", () => { if (mounts.get(input.link.id) === handle) void stopMount(handle); });
    try { await waitForGoogleDriveMount(child, mountPoint); return mountPoint; } catch (error) { await stopMount(handle); throw error; }
  });
}

// Drive mounts live on a shared-propagation volume, so they outlive the API process that created
// them. Detach any mount point this process does not own; it is a dead leftover.
export async function detachStaleGoogleDriveMounts(mountPoints: string[]): Promise<void> {
  const owned = new Set(Array.from(mounts.values(), (handle) => handle.mountPoint));
  await Promise.all(mountPoints
    .map((mountPoint) => path.resolve(mountPoint))
    .filter((mountPoint) => !owned.has(mountPoint))
    .map((mountPoint) => detachMountStack(mountPoint)));
}

export async function releaseGoogleDriveFolderMount(linkId: string, consumerId: string): Promise<void> {
  const handle = mounts.get(linkId);
  if (!handle) return;
  handle.references.delete(consumerId);
  if (handle.references.size === 0 && handle.unlinkRequested) await stopMount(handle);
}

export async function releaseGoogleDriveFolderMountsForConsumer(consumerId: string): Promise<void> {
  await Promise.all(Array.from(mounts.keys()).map((linkId) => releaseGoogleDriveFolderMount(linkId, consumerId)));
}

export function getGoogleDriveFolderMountConsumers(linkId: string): string[] {
  return Array.from(mounts.get(linkId)?.references ?? []);
}

export async function unlinkGoogleDriveFolderMount(linkId: string, attachmentConsumerId?: string): Promise<void> {
  await withMountLock(linkId, async () => {
    const handle = mounts.get(linkId);
    if (!handle) return;
    handle.unlinkRequested = true;
    if (attachmentConsumerId) {
      handle.references.delete(attachmentConsumerId);
    }
    for (const consumerId of handle.references) {
      if (consumerId.startsWith("attachment:")) {
        handle.references.delete(consumerId);
      }
    }
    const activeTaskConsumers = Array.from(handle.references).filter((consumerId) => consumerId.includes(":"));
    if (activeTaskConsumers.length > 0) {
      throw new SourceFileLinkActionError(
        "This Google Drive folder is still attached to a running task. Stop that task before removing the folder."
      );
    }
    if (handle.references.size === 0) await stopMount(handle);
  });
}
