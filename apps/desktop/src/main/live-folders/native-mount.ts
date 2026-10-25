import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { googleDriveMountArgs, type LocalLiveFolderConfig } from "@meowbert/shared";
import { HostProcesses, cleanupHostProcesses } from "../executor/host-processes";

const execFile = promisify(execFileCallback);
export interface LiveFolderMount { path: string; stop(): Promise<void>; isReady?(): Promise<boolean> }

async function mounted(mountPoint: string): Promise<boolean> {
  const parent = await fs.realpath(path.dirname(mountPoint)).catch(() => path.dirname(mountPoint));
  const canonical = path.join(parent, path.basename(mountPoint));
  const { stdout } = await execFile("/sbin/mount", [], { timeout: 2_000 });
  return stdout.split("\n").some((line) => line.includes(" on " + canonical + " (") && /\bnfs\b/.test(line));
}

async function unmount(mountPoint: string): Promise<void> {
  if (!await mounted(mountPoint)) return;
  await execFile("/usr/sbin/diskutil", ["unmount", "force", mountPoint], { timeout: 10_000, killSignal: "SIGKILL" });
  if (await mounted(mountPoint)) throw new Error("The live Drive folder could not be unmounted.");
}

// Only lists app-owned mount records, never a workspace or a remote folder.
export async function cleanupLiveFolderMounts(root: string): Promise<void> {
  if (process.platform !== "darwin") return;
  const mounts = path.join(root, "mounts");
  const names = await fs.readdir(mounts).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const name of names.filter((entry) => /^[a-f0-9-]{36}$/i.test(entry))) await unmount(path.join(mounts, name));
  await cleanupHostProcesses(path.join(root, "processes"));
  await fs.rm(path.join(root, "credentials"), { recursive: true, force: true });
}

export async function startNativeLiveFolder(input: {
  root: string; binary: string; folder: LocalLiveFolderConfig; signal: AbortSignal;
}): Promise<LiveFolderMount> {
  if (process.platform !== "darwin") throw new Error("Live Drive folders are available in macOS host mode.");
  if (!/^[a-f0-9]{64}$/.test(input.folder.connectionId)) throw new Error("Invalid live-folder connection.");
  if (!/^[a-f0-9-]{36}$/i.test(input.folder.linkId)) throw new Error("Invalid live-folder ID.");
  input.signal.throwIfAborted();
  const mountPoint = path.join(input.root, "mounts", input.folder.linkId);
  const configDir = path.join(input.root, "credentials", input.folder.linkId);
  const configPath = path.join(configDir, "rclone.conf");
  const processes = new HostProcesses(path.join(input.root, "processes", input.folder.linkId + ".pids"));
  let stopped: Promise<void> | null = null;
  const stop = () => stopped ??= (async () => {
    let unmountFailed = false;
    try { await unmount(mountPoint); } catch { unmountFailed = true; }
    try { await processes.stop(); }
    finally { await fs.rm(configDir, { recursive: true, force: true }); }
    if (unmountFailed) await unmount(mountPoint);
  })();
  try {
    await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
    await fs.mkdir(mountPoint, { recursive: true, mode: 0o700 });
    await fs.writeFile(configPath, input.folder.config, { mode: 0o600 });
    const command = [input.binary, ...googleDriveMountArgs({ configPath, mountPoint, transport: "nfs",
      cacheDir: path.join(input.root, "cache", input.folder.connectionId, input.folder.linkId) }), "--addr", "127.0.0.1:0"];
    const child = await processes.start({ command, workingDir: input.root, tty: false });
    let exited = false;
    void child.waitForExit().then(() => { exited = true; }, () => { exited = true; });
    // Drain output without exposing OAuth credentials in logs or user-facing errors.
    child.stdout.resume(); child.stderr?.resume();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      input.signal.throwIfAborted();
      if (exited) throw new Error("The live Drive folder could not be mounted. Check Google Drive access and macOS NFS permissions.");
      if (await mounted(mountPoint)) return { path: mountPoint, stop, isReady: async () => !exited && !stopped && await mounted(mountPoint) };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Timed out mounting the live Drive folder.");
  } catch (error) { await stop(); throw error; }
}
