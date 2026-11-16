import fs from "node:fs/promises";
import {
  ensureSandboxWritablePath,
  removeTaskScratchDirs,
  resolveTaskHistoryDir,
  resolveTaskScratchDir,
  resolveWorkspaceScratchDir
} from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { withTransaction, query } from "../../lib/db.js";
import { assignTaskScratchProject } from "../storage/task-scratch-accounting.js";

const SCRATCH_DIR_MODE = 0o2775;

export async function ensureTaskScratchDir(input: { workspaceId: string; taskId: string }): Promise<string> {
  const scratchRoot = config.runtime.taskScratch.root;
  const workspaceScratchDir = resolveWorkspaceScratchDir(scratchRoot, input.workspaceId);
  const taskScratchDir = resolveTaskScratchDir(scratchRoot, input.workspaceId, input.taskId);

  return withTransaction(async (client) => {
    const task = await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [input.taskId]);
    if (!task.rowCount) throw new Error("Task not found");
    await fs.mkdir(workspaceScratchDir, { recursive: true, mode: SCRATCH_DIR_MODE });
    const created = await fs.mkdir(taskScratchDir, { mode: SCRATCH_DIR_MODE }).then(() => true).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") return false;
      throw error;
    });
    if (created) {
      await client.query("UPDATE tasks SET scratch_project_id = NULL WHERE id = $1", [input.taskId]);
      await assignTaskScratchProject(client, input.taskId, taskScratchDir).catch((error: unknown) => {
        console.warn(`[task-scratch] Size accounting unavailable for ${input.taskId}:`, error);
      });
    }
    await ensureSandboxWritablePath({ rootPath: scratchRoot, targetPath: taskScratchDir });
    await client.query("UPDATE tasks SET scratch_present = true WHERE id = $1", [input.taskId]);
    return taskScratchDir;
  });
}

// Only the executor writes here; the sandbox mounts it read-only.
export async function ensureTaskHistoryDir(input: { workspaceId: string; taskId: string }): Promise<string> {
  const historyDir = resolveTaskHistoryDir(config.runtime.taskScratch.root, input.workspaceId, input.taskId);
  await fs.mkdir(historyDir, { recursive: true, mode: 0o755 });
  return historyDir;
}

export async function removeTasksScratch(workspaceId: string, taskIds: string[]): Promise<void> {
  await removeTaskScratchDirs(config.runtime.taskScratch.root, workspaceId, taskIds);
  await query("UPDATE tasks SET scratch_present = false WHERE workspace_id = $1 AND id = ANY($2::uuid[])", [workspaceId, taskIds]);
}
