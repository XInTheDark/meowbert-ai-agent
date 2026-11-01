import fs from "node:fs/promises";
import {
  ensureSandboxWritablePath,
  removeTaskScratchDirs,
  resolveTaskHistoryDir,
  resolveTaskScratchDir,
  resolveWorkspaceScratchDir
} from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { ensureWorkspaceScratchQuota } from "../storage/task-scratch-quota.js";

const SCRATCH_DIR_MODE = 0o2775;

export async function ensureTaskScratchDir(input: { workspaceId: string; taskId: string }): Promise<string> {
  const scratchRoot = config.runtime.taskScratch.root;
  const workspaceScratchDir = resolveWorkspaceScratchDir(scratchRoot, input.workspaceId);
  const taskScratchDir = resolveTaskScratchDir(scratchRoot, input.workspaceId, input.taskId);

  await fs.mkdir(workspaceScratchDir, { recursive: true, mode: SCRATCH_DIR_MODE });
  // The scratch filesystem's own size still caps everything if a workspace quota can't be set.
  await ensureWorkspaceScratchQuota({ workspaceId: input.workspaceId, workspaceScratchDir }).catch((error: unknown) => {
    console.warn(`[task-scratch] Could not apply scratch quota for workspace ${input.workspaceId}: ${error instanceof Error ? error.message : String(error)}`);
  });
  await fs.mkdir(taskScratchDir, { recursive: true, mode: SCRATCH_DIR_MODE });
  await ensureSandboxWritablePath({ rootPath: scratchRoot, targetPath: taskScratchDir });
  return taskScratchDir;
}

// Only the executor writes here; the sandbox mounts it read-only.
export async function ensureTaskHistoryDir(input: { workspaceId: string; taskId: string }): Promise<string> {
  const historyDir = resolveTaskHistoryDir(config.runtime.taskScratch.root, input.workspaceId, input.taskId);
  await fs.mkdir(historyDir, { recursive: true, mode: 0o755 });
  return historyDir;
}

export async function removeTasksScratch(workspaceId: string, taskIds: string[]): Promise<void> {
  await removeTaskScratchDirs(config.runtime.taskScratch.root, workspaceId, taskIds);
}
