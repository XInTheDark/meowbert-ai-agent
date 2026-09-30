import { withTransaction } from "../../lib/db.js";
import { requireSubagentTarget } from "./access.js";
import type { SubagentCaller } from "./types.js";

export async function interruptSubagent(caller: SubagentCaller, targetId: string): Promise<string> {
  const target = await requireSubagentTarget(caller, targetId);
  if (!target.parent_task_id || target.id === caller.taskId) throw new Error("Only another subagent can be interrupted.");
  await withTransaction(async (client) => {
    await client.query(
      `WITH RECURSIVE scope AS (SELECT id FROM tasks WHERE id = $1
       UNION ALL SELECT t.id FROM tasks t JOIN scope s ON t.parent_task_id = s.id)
       UPDATE tasks SET cancellation_requested = true, resume_after_interrupt = false,
         status = CASE WHEN status IN ('starting', 'running') THEN status ELSE 'cancelled' END, updated_at = now()
       WHERE id IN (SELECT id FROM scope) AND status IN ('queued', 'starting', 'running', 'awaiting_input')`, [targetId]
    );
    await client.query(
      `UPDATE task_runs SET ended_at = now(), exit_reason = 'cancelled' WHERE ended_at IS NULL
       AND task_id IN (SELECT id FROM tasks WHERE status = 'cancelled' AND cancellation_requested)
       AND task_id IN (SELECT task_id FROM task_subagent_sessions WHERE root_task_id = $1)`, [target.root_task_id]
    );
    await client.query(
      `UPDATE task_run_dispatches SET queue_state = 'cancelled', finished_at = now()
       WHERE run_id IN (SELECT id FROM task_runs WHERE exit_reason = 'cancelled' AND ended_at IS NOT NULL)
       AND task_id IN (SELECT task_id FROM task_subagent_sessions WHERE root_task_id = $1)`, [target.root_task_id]
    );
  });
  return target.status;
}
