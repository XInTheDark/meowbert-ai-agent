import { withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import type { RunDeliveryInput } from "../notifications/run-delivery-types.js";

// Completion and its delivery intent must commit together. Redis is not the source of truth.
export async function completeTaskRun(input: RunDeliveryInput): Promise<boolean> {
  const completed = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE tasks SET status = 'succeeded', completed_at = now(), updated_at = now()
        WHERE id = $1 AND EXISTS (
          SELECT 1 FROM task_runs r WHERE r.id = $2 AND r.task_id = $1 AND r.ended_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM task_runs newer
                             WHERE newer.task_id = r.task_id AND newer.attempt_no > r.attempt_no)
        ) RETURNING id`,
      [input.taskId, input.runId]
    );
    const runResult = await client.query(
      `UPDATE task_runs SET ended_at = now(), exit_reason = 'completed', error_summary = NULL, notification_requested = $2
        WHERE id = $1 AND task_id = $3 AND ended_at IS NULL`,
      [input.runId, Boolean(result.rowCount) && input.notificationRequested && !input.isSubtask && input.finalResponse.length > 0, input.taskId]
    );
    if (runResult.rowCount) {
      await client.query(
        `UPDATE task_run_dispatches SET queue_state = 'finished', finished_at = now(), updated_at = now()
          WHERE run_id = $1`, [input.runId]
      );
    }
    if (!result.rowCount) return false;
    await client.query(
      `INSERT INTO local_run_memory_refreshes (run_id, workspace_id, delay_seconds, due_at)
       SELECT $1, t.workspace_id, delay, now() + (delay * interval '1 second')
         FROM tasks t CROSS JOIN unnest(ARRAY[0, 60, 300]) AS delay
        WHERE t.id = $2 AND t.execution_target->>'kind' = 'local'
          AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = t.workspace_id AND w.file_host->>'kind' = 'server')
          AND COALESCE((SELECT memory_enabled FROM workspace_settings WHERE workspace_id = t.workspace_id), true)
       ON CONFLICT (run_id, delay_seconds) DO NOTHING`, [input.runId, input.taskId]
    );
    if (!input.isSubtask && input.finalResponse.length > 0) {
      await client.query(
        `INSERT INTO task_run_deliveries (run_id, task_id, payload_json) VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (run_id) DO NOTHING`,
        [input.runId, input.taskId, JSON.stringify(input)]
      );
    }
    return true;
  });
  if (completed) {
    await emitTaskEvent(input.taskId, "status", { status: "succeeded" }).catch((error) => {
      console.warn("Unable to publish completed task status", error);
    });
  }
  return completed;
}
