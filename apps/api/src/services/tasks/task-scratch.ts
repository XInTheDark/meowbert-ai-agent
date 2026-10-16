import { removeTaskScratchDirs, removeWorkspaceScratchDir } from "@meowbert/shared";
import { config } from "../../lib/config.js";

export async function removeTasksScratch(workspaceId: string, taskIds: string[]): Promise<void> {
  await removeTaskScratchDirs(config.runtime.taskScratch.root, workspaceId, taskIds);
}

export async function removeWorkspaceScratch(workspaceId: string): Promise<void> {
  await removeWorkspaceScratchDir(config.runtime.taskScratch.root, workspaceId);
}
