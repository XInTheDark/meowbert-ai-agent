import fs from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { decodeMountInfoPath } from "./docker-sandbox-mounts.js";

const execFile = promisify(execFileCallback);

export interface MountDeviceInfo {
  source: string;
  major: number;
  minor: number;
}

export function findMountDevice(mountInfoText: string, mountPath: string): MountDeviceInfo | null {
  const resolvedMountPath = path.resolve(mountPath);
  for (const line of mountInfoText.split("\n")) {
    const separator = line.indexOf(" - ");
    if (separator < 0) continue;

    const leftFields = line.slice(0, separator).trim().split(" ");
    const rightFields = line.slice(separator + 3).trim().split(" ");
    const mountPoint = leftFields[4];
    const [major, minor] = (leftFields[2] ?? "").split(":").map((value) => Number.parseInt(value, 10));
    const source = rightFields[1];
    if (!mountPoint || !source || !Number.isInteger(major) || !Number.isInteger(minor)) continue;
    if (path.resolve(decodeMountInfoPath(mountPoint)) !== resolvedMountPath) continue;

    return { source: decodeMountInfoPath(source), major: major!, minor: minor! };
  }
  return null;
}

// xfs_quota looks up the block device named in the mount table. Containers see the mount
// through a bind but not the device node, so recreate the node when it is missing.
export async function ensureMountDeviceNode(mountPath: string): Promise<void> {
  const mountInfoText = await fs.readFile("/proc/self/mountinfo", "utf8").catch(() => "");
  const device = findMountDevice(mountInfoText, mountPath);
  if (!device || !device.source.startsWith("/dev/")) return;

  const existing = await fs.stat(device.source).catch(() => null);
  if (existing) return;

  await execFile("mknod", [device.source, "b", String(device.major), String(device.minor)]).catch((error: unknown) => {
    console.warn(`[xfs-quota] Could not create device node ${device.source}: ${error instanceof Error ? error.message : String(error)}`);
  });
}
