import path from "node:path";
import { query } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "../environments/environment-storage.js";

export async function ensureEnvironmentRootById(environmentId: string): Promise<string> {
  const environmentRes = await query<{
    id: string;
    workspace_id: string;
    root_path: string;
  }>(
    `SELECT id, workspace_id, root_path
       FROM environments
      WHERE id = $1`,
    [environmentId]
  );

  if ((environmentRes.rowCount ?? 0) === 0) {
    throw new Error("Project not found");
  }

  return ensureEnvironmentStorageRoot(environmentRes.rows[0]);
}

export async function resolveTaskInputsDirForEnvironment(input: {
  environmentId: string;
  taskId: string;
}): Promise<string> {
  const taskRes = await query<{
    environment_id: string;
    workspace_id: string;
    root_path: string;
    task_root_path: string;
  }>(
    `SELECT e.id AS environment_id,
            e.workspace_id,
            e.root_path,
            t.task_root_path
       FROM tasks t
       JOIN environments e
         ON e.id = t.environment_id
      WHERE t.id = $1
        AND t.environment_id = $2`,
    [input.taskId, input.environmentId]
  );

  if ((taskRes.rowCount ?? 0) === 0) {
    throw new Error("Task not found");
  }

  const task = taskRes.rows[0];
  const environmentRoot = await ensureEnvironmentStorageRoot({
    id: task.environment_id,
    workspace_id: task.workspace_id,
    root_path: task.root_path
  });

  return path.resolve(environmentRoot, task.task_root_path, "inputs");
}
