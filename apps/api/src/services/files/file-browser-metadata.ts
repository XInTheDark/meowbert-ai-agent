import fsPromises from "node:fs/promises";
import path from "node:path";
import { calculatePathUsageBytes } from "@meowbert/shared";
import { resolveRealPathWithinRoot } from "@meowbert/shared/server-security";

export interface DirectorySizeEntry {
  relativePath: string;
  sizeBytes: number;
}

interface PendingTask<T> {
  index: number;
  task: () => Promise<T>;
}

function toWebPath(input: string): string {
  return input.split(path.sep).join("/");
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  if (tasks.length === 0) {
    return [];
  }

  const safeConcurrency = Math.max(1, Math.min(concurrency, tasks.length));
  const queue: Array<PendingTask<T>> = tasks.map((task, index) => ({ index, task }));
  const results = new Array<T>(tasks.length);

  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) {
        return;
      }
      results[next.index] = await next.task();
    }
  });

  await Promise.all(workers);
  return results;
}

export async function listDirectorySizeEntries(input: {
  rootPath: string;
  requestedPath?: string;
  concurrency?: number;
}): Promise<{
  cwd: string;
  items: DirectorySizeEntry[];
}> {
  const target = await resolveRealPathWithinRoot(input.rootPath, input.requestedPath);
  const folderStats = await fsPromises.lstat(target.absolutePath).catch(() => null);

  if (!folderStats || !folderStats.isDirectory()) {
    throw new Error("Directory not found");
  }

  const entries = await fsPromises.readdir(target.absolutePath, { withFileTypes: true });
  const directoryEntries = entries.filter((entry) => entry.isDirectory());
  const tasks = directoryEntries.map((entry) => async () => {
    const absoluteEntryPath = path.join(target.absolutePath, entry.name);
    return {
      relativePath: toWebPath(path.relative(target.rootRealPath, absoluteEntryPath)),
      sizeBytes: await calculatePathUsageBytes(absoluteEntryPath)
    } satisfies DirectorySizeEntry;
  });

  const items = await runWithConcurrency(tasks, input.concurrency ?? 4);
  return {
    cwd: target.relativePath,
    items
  };
}
