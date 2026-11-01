import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gzip as zip, gunzip as unzip } from "node:zlib";
import type { NormalizedTaskHistoryArchiveConfig } from "./task-history-archive.js";
import { createTaskArchiveCache } from "./task-history-archive-cache.js";

const gzip = promisify(zip);
const gunzip = promisify(unzip);
const cache = createTaskArchiveCache();
export const archiveDigest = (value: string): string => createHash("sha256").update(value).digest("hex");

export function taskArchivePath(config: NormalizedTaskHistoryArchiveConfig, key: string): string {
  if (!config.rootPath) throw new Error("Task history archive storage is not configured.");
  const absolute = path.resolve(config.rootPath, key);
  if (!absolute.startsWith(`${path.resolve(config.rootPath)}${path.sep}`)) throw new Error("Invalid archive path.");
  return absolute;
}

export async function readArchiveJson(config: NormalizedTaskHistoryArchiveConfig, key: string): Promise<unknown> {
  const absolute = taskArchivePath(config, key);
  const raw = await cache.read(absolute, async () => {
    const text = (await gunzip(await fs.readFile(absolute))).toString("utf8");
    const digest = path.basename(key).split(".")[0];
    if (key.startsWith("v2/") && archiveDigest(text) !== digest) throw new Error(`Archive checksum mismatch: ${key}`);
    return text;
  });
  // A fresh object per reader prevents one caller's edits from poisoning cached history.
  return JSON.parse(raw) as unknown;
}

export async function writeArchiveJson(config: NormalizedTaskHistoryArchiveConfig, directory: string, value: unknown) {
  const raw = JSON.stringify(value);
  const digest = archiveDigest(raw);
  const key = path.posix.join(directory, `${digest}.json.gz`);
  const absolute = taskArchivePath(config, key);
  try {
    const stored = await fs.readFile(absolute);
    const existing = await gunzip(stored);
    if (archiveDigest(existing.toString("utf8")) !== digest) throw new Error(`Archive checksum mismatch: ${key}`);
    return { key, bytes: Buffer.byteLength(raw), compressedBytes: stored.byteLength };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const compressed = await gzip(Buffer.from(raw));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${randomUUID()}`;
  try {
    const handle = await fs.open(temporary, "wx");
    try { await handle.writeFile(compressed); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, absolute);
    const verified = (await gunzip(await fs.readFile(absolute))).toString("utf8");
    if (archiveDigest(verified) !== digest) throw new Error(`Archive verification failed: ${key}`);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
  return { key, bytes: Buffer.byteLength(raw), compressedBytes: compressed.byteLength };
}
