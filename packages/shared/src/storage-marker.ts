import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const STORAGE_MARKER_FILE = ".meowbert-storage.json";
export const STORAGE_PROBE_PREFIX = ".meowbert-probe-";

export interface StorageMarker {
  version: 1;
  backendId: string;
  installId: string;
}

export interface StorageProbeResult {
  ok: boolean;
  marker: StorageMarker | null;
  reason?: "missing_marker" | "invalid_marker" | "wrong_backend" | "not_writable";
}

export function storageMarkerPath(root: string): string {
  return path.join(path.resolve(root), STORAGE_MARKER_FILE);
}

export function storageProbePath(root: string, deviceId: string): string {
  const safeDeviceId = deviceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(path.resolve(root), `${STORAGE_PROBE_PREFIX}${safeDeviceId}`);
}

function isStorageMarker(value: unknown): value is StorageMarker {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<StorageMarker>;
  return candidate.version === 1
    && typeof candidate.backendId === "string"
    && candidate.backendId.length > 0
    && typeof candidate.installId === "string"
    && candidate.installId.length > 0;
}

export async function readStorageMarker(root: string): Promise<StorageMarker | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(storageMarkerPath(root), "utf8"));
    return isStorageMarker(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeStorageMarker(root: string, marker: StorageMarker): Promise<void> {
  await fs.mkdir(path.resolve(root), { recursive: true });
  const target = storageMarkerPath(root);
  try {
    const existing = await readStorageMarker(root);
    if (existing) {
      if (existing.backendId !== marker.backendId || existing.installId !== marker.installId) {
        throw new Error(`Storage marker at ${target} belongs to another installation.`);
      }
      return;
    }
    await fs.writeFile(target, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
    throw error;
  }
}

export async function verifyStorageRoot(input: {
  root: string;
  backendId: string;
  installId?: string;
  deviceId: string;
}): Promise<StorageProbeResult> {
  const marker = await readStorageMarker(input.root);
  if (!marker) {
    try {
      await fs.access(storageMarkerPath(input.root));
      return { ok: false, marker: null, reason: "invalid_marker" };
    } catch {
      return { ok: false, marker: null, reason: "missing_marker" };
    }
  }
  if (marker.backendId !== input.backendId || (input.installId && marker.installId !== input.installId)) return { ok: false, marker, reason: "wrong_backend" };

  const probe = storageProbePath(input.root, input.deviceId + "-" + randomUUID());
  try {
    await fs.writeFile(probe, `${Date.now()}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fs.unlink(probe);
    return { ok: true, marker };
  } catch {
    await fs.unlink(probe).catch(() => undefined);
    return { ok: false, marker, reason: "not_writable" };
  }
}
