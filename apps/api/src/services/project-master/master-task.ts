import { randomUUID } from "node:crypto";
import { getProjectMasterEnabled } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";

export class ProjectMasterError extends Error {
  readonly exposeMessage = true;

  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "ProjectMasterError";
  }
}

export interface ProjectMasterTask {
  taskId: string;
  environmentId: string;
  workspaceId: string;
}

export async function isProjectMasterEnabledForWorkspace(workspaceId: string): Promise<boolean> {
  const result = await query<{ model_defaults_json: Record<string, unknown> | null }>(
    "SELECT model_defaults_json FROM workspace_settings WHERE workspace_id = $1",
    [workspaceId]
  );
  return getProjectMasterEnabled(result.rows[0]?.model_defaults_json);
}

export async function getProjectMasterTaskId(environmentId: string): Promise<string | null> {
  const result = await query<{ task_id: string }>(
    "SELECT task_id FROM project_masters WHERE environment_id = $1",
    [environmentId]
  );
  return result.rows[0]?.task_id ?? null;
}

export async function isProjectMasterTask(taskId: string): Promise<boolean> {
  const result = await query("SELECT 1 FROM project_masters WHERE task_id = $1", [taskId]);
  return (result.rowCount ?? 0) > 0;
}

export async function loadProjectMasterByTaskId(taskId: string): Promise<ProjectMasterTask | null> {
  const result = await query<{ task_id: string; environment_id: string; workspace_id: string }>(
    `SELECT pm.task_id, pm.environment_id, t.workspace_id
       FROM project_masters pm
       JOIN tasks t ON t.id = pm.task_id
      WHERE pm.task_id = $1`,
    [taskId]
  );
  const row = result.rows[0];
  return row ? { taskId: row.task_id, environmentId: row.environment_id, workspaceId: row.workspace_id } : null;
}

// The Master starts as an idle, hidden task so the first user message simply follows up on it.
export async function ensureProjectMasterTask(input: {
  environmentId: string;
  workspaceId: string;
  userId: string;
  timezone: string;
}): Promise<string> {
  if (!(await isProjectMasterEnabledForWorkspace(input.workspaceId))) {
    throw new ProjectMasterError("Project Master is not enabled for this workspace.", 409);
  }

  return withTransaction(async (client) => {
    await client.query("SELECT id FROM environments WHERE id = $1 FOR UPDATE", [input.environmentId]);
    const existing = await client.query<{ task_id: string }>(
      "SELECT task_id FROM project_masters WHERE environment_id = $1",
      [input.environmentId]
    );
    if (existing.rows[0]) {
      return existing.rows[0].task_id;
    }

    const taskId = randomUUID();
    await client.query(
      `INSERT INTO tasks (id, workspace_id, environment_id, title, status, source, initiator_user_id,
                          default_timezone, task_root_path, is_hidden)
       VALUES ($1, $2, $3, 'Master', 'succeeded', 'web', $4, $5, $6, true)`,
      [taskId, input.workspaceId, input.environmentId, input.userId, input.timezone, `.meowbert/task-runs/${taskId}`]
    );
    await client.query(
      "INSERT INTO project_masters (environment_id, task_id) VALUES ($1, $2)",
      [input.environmentId, taskId]
    );
    return taskId;
  });
}
