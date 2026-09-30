import type { TaskStatus } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";

export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  await query(
    `UPDATE tasks
        SET status = $2,
            updated_at = now(),
            completed_at = CASE WHEN $2 IN ('succeeded', 'failed', 'cancelled') THEN now() ELSE NULL END
      WHERE id = $1`,
    [taskId, status]
  );

  await emitTaskEvent(taskId, "status", { status });
}

export async function setTaskStatusForRun(taskId: string, runId: string, status: TaskStatus): Promise<boolean> {
  const result = await query<{ id: string }>(
    `UPDATE tasks
        SET status = $3,
            updated_at = now(),
            completed_at = CASE WHEN $3 IN ('succeeded', 'failed', 'cancelled') THEN now() ELSE NULL END
      WHERE id = $1
        AND EXISTS (
          SELECT 1
            FROM task_runs current_run
           WHERE current_run.task_id = $1
             AND current_run.id = $2
             AND current_run.ended_at IS NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM task_runs newer
                WHERE newer.task_id = current_run.task_id
                  AND newer.attempt_no > current_run.attempt_no
             )
        )
      RETURNING id`,
    [taskId, runId, status]
  );

  if ((result.rowCount ?? 0) === 0) {
    return false;
  }

  await emitTaskEvent(taskId, "status", { status });
  return true;
}

export async function isCancellationRequested(taskId: string): Promise<boolean> {
  const result = await query<{ cancellation_requested: boolean }>(
    `SELECT cancellation_requested FROM tasks WHERE id = $1`,
    [taskId]
  );
  return result.rows[0]?.cancellation_requested ?? false;
}

export async function consumeResumeAfterInterrupt(taskId: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `UPDATE tasks
        SET resume_after_interrupt = false,
            updated_at = now()
      WHERE id = $1
        AND resume_after_interrupt = true
      RETURNING id`,
    [taskId]
  );

  return (result.rowCount ?? 0) > 0;
}
