import type { PoolClient } from "pg";

// Stops and interrupts must reach the worker even when the original run was scheduled later.
export async function expeditePendingTaskDispatchesInTx(client: PoolClient, taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  await client.query(
    `UPDATE task_run_dispatches
        SET eligible_at = LEAST(eligible_at, now()), updated_at = now()
      WHERE task_id = ANY($1::uuid[])
        AND queue_state = 'pending'`,
    [taskIds]
  );
}
