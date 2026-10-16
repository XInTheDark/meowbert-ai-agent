import fs from "node:fs/promises";
import path from "node:path";
import { isWithinPath } from "./fs-guards.js";

function resolveScratchChild(parentDir: string, name: string): string {
  const childPath = path.resolve(parentDir, name);
  if (name.trim().length === 0 || path.dirname(childPath) !== path.resolve(parentDir)) {
    throw new Error(`Invalid task scratch path segment: ${name}`);
  }
  return childPath;
}

export function resolveWorkspaceScratchDir(scratchRoot: string, workspaceId: string): string {
  return resolveScratchChild(scratchRoot, workspaceId);
}

export function resolveTaskScratchDir(scratchRoot: string, workspaceId: string, taskId: string): string {
  return resolveScratchChild(resolveWorkspaceScratchDir(scratchRoot, workspaceId), taskId);
}

async function removeScratchPath(scratchRoot: string, targetPath: string): Promise<void> {
  if (!isWithinPath(path.resolve(scratchRoot), targetPath) || path.resolve(scratchRoot) === targetPath) {
    return;
  }
  await fs.rm(targetPath, { recursive: true, force: true }).catch((error: unknown) => {
    console.warn(`[task-scratch] Failed to remove ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

// Scratch lives on local disk that Meowbert owns, so removing a task's tree here is cheap.
export async function removeTaskScratchDirs(scratchRoot: string, workspaceId: string, taskIds: string[]): Promise<void> {
  for (const taskId of new Set(taskIds)) {
    await removeScratchPath(scratchRoot, resolveTaskScratchDir(scratchRoot, workspaceId, taskId));
  }
}

export async function removeWorkspaceScratchDir(scratchRoot: string, workspaceId: string): Promise<void> {
  await removeScratchPath(scratchRoot, resolveWorkspaceScratchDir(scratchRoot, workspaceId));
}
