import type { PoolClient } from "pg";
import { query } from "../../lib/db.js";
import type { SubagentCaller, SubagentTask } from "./types.js";

export async function loadSubagentTask(taskId: string, client?: PoolClient): Promise<SubagentTask> {
  const sql = `SELECT t.*, COALESCE(s.root_task_id, t.id) AS root_task_id FROM tasks t
       LEFT JOIN task_subagent_sessions s ON s.task_id = t.id WHERE t.id = $1`;
  const result = client
    ? await client.query<SubagentTask>(sql, [taskId])
    : await query<SubagentTask>(sql, [taskId]);
  if (!result.rows[0]) throw new Error("Task not found.");
  return result.rows[0];
}

export async function requireSubagentTarget(caller: SubagentCaller, targetId: string): Promise<SubagentTask> {
  const [sender, target] = await Promise.all([loadSubagentTask(caller.taskId), loadSubagentTask(targetId)]);
  if (sender.workspace_id !== caller.workspaceId || sender.environment_id !== caller.environmentId
    || target.root_task_id !== sender.root_task_id || target.workspace_id !== sender.workspace_id) {
    throw new Error("Subagent must belong to this task tree.");
  }
  return target;
}
