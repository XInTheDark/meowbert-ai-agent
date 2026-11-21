import type { PoolClient } from "pg";

// Requests an interrupt-and-resume on actively running swarm tasks (the same path as "Send now"
// for queued user messages): aborts an in-flight wait, foreground shell command, or model request
// and immediately resumes with pending inbox items. Never overrides an explicit cancellation.
// Caller holds the swarm lock.
export async function interruptRunningSwarmTasksInTx(client: PoolClient, taskIds: string[]): Promise<string[]> {
  const uniqueSorted = [...new Set(taskIds)].sort();
  if (uniqueSorted.length === 0) return [];
  const result = await client.query<{ id: string }>(
    `UPDATE tasks
        SET cancellation_requested = true,
            resume_after_interrupt = true,
            updated_at = now()
      WHERE id = ANY($1::uuid[])
        AND status IN ('starting', 'running')
        AND NOT cancellation_requested
        AND EXISTS (SELECT 1 FROM task_runs run WHERE run.task_id = tasks.id AND run.ended_at IS NULL)
      RETURNING id`,
    [uniqueSorted]
  );
  return result.rows.map((row) => row.id);
}
