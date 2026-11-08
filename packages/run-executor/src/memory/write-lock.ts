import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { getWorkspaceMemoryDir } from "./main-files.js";

// Cooperative: shell edits opt in, and every index_save uses the same filesystem lock.
// Keep the lock outside .memory so indexing and refreshes never consume lock metadata.
export async function withMemoryWriteLock<T>(
  workspaceRoot: string,
  write: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted();
  const memoryDir = getWorkspaceMemoryDir(workspaceRoot);
  await fs.mkdir(memoryDir, { recursive: true });
  const canonicalDir = await fs.realpath(memoryDir);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  let release: (() => Promise<void>) | undefined;
  let compromised = false;
  try {
    release = await lockfile.lock(canonicalDir, {
      lockfilePath: path.join(path.dirname(canonicalDir), ".memory.write.lock"),
      stale: 60_000,
      update: 10_000,
      retries: { retries: 50, factor: 1, minTimeout: 100, maxTimeout: 100 },
      onCompromised: (error) => { compromised = true; controller.abort(error); }
    });
    if (signal?.aborted) cancel();
    controller.signal.throwIfAborted();
    const result = await write(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (!compromised) await release?.();
  }
}
