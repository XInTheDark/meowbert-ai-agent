import { query, withTransaction } from "../../lib/db.js";
import { requireSubagentTarget } from "./access.js";
import { ensureTaskHistoryWarm } from "../tasks/task-history.js";
import type { SubagentCaller } from "./types.js";

export async function sendSubagentMessage(input: SubagentCaller & {
  target: string; message: string; followup: boolean; deliveryKey: string;
}): Promise<void> {
  const target = await requireSubagentTarget(input, input.target);
  if (input.followup && (!target.parent_task_id || target.id === input.taskId)) {
    throw new Error("Follow-up assignments must target another subagent.");
  }
  await ensureTaskHistoryWarm(input.target);
  await withTransaction(async (client) => {
    await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [input.target]);
    await client.query(
      `INSERT INTO task_subagent_mail(recipient_task_id, sender_task_id, kind, body, delivery_key, wake)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (delivery_key) DO NOTHING`,
      [input.target, input.taskId, input.followup ? "assignment" : "message", input.message, input.deliveryKey, input.followup]
    );
  });
}

export async function hasSubagentMail(taskId: string): Promise<boolean> {
  const result = await query<{ ready: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM task_subagent_mail WHERE recipient_task_id = $1 AND delivered_at IS NULL) AS ready`, [taskId]
  );
  return result.rows[0]?.ready === true;
}

export async function listSubagents(caller: SubagentCaller) {
  const task = await requireSubagentTarget(caller, caller.taskId);
  const result = await query(
    `SELECT t.id AS subagent_id, t.parent_task_id, t.title, t.status, t.task_root_path,
       s.model_tier AS model, w.task_id IS NOT NULL AS waiting
     FROM task_subagent_sessions s JOIN tasks t ON t.id = s.task_id
     LEFT JOIN task_subagent_waits w ON w.task_id = t.id
     WHERE s.root_task_id = $1 ORDER BY s.created_at, t.id`, [task.root_task_id]
  );
  return result.rows;
}

export async function assertSubagentsFinished(taskId: string): Promise<void> {
  const result = await query<{ active: boolean }>(
    `WITH RECURSIVE descendants AS (
       SELECT id, status, cancellation_requested FROM tasks WHERE parent_task_id = $1
       UNION ALL SELECT t.id, t.status, t.cancellation_requested FROM tasks t JOIN descendants d ON t.parent_task_id = d.id
     ) SELECT EXISTS(SELECT 1 FROM descendants WHERE status IN ('queued', 'starting', 'running', 'awaiting_input')
       AND NOT cancellation_requested) AS active`, [taskId]
  );
  if (result.rows[0]?.active) throw new Error("Subagents are still working. Wait for their results or explicitly interrupt them before finishing.");
}
