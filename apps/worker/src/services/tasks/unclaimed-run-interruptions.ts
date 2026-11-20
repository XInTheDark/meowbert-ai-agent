import type { TaskExecutionJob } from "@meowbert/shared";
import { withTransaction } from "../../lib/db.js";
import { finishFailedLaneRun } from "../agent-swarm/run-finalize.js";
import { handleCancelledRun } from "../run-host/run-cancellation.js";

// These runs have no executor that can acknowledge a stop or interrupt. Revoke admission first,
// then use the same continuation path as a running executor, without waiting for capacity.
export async function settleUnclaimedRunInterruptionsOnce(): Promise<number> {
  const jobs = await withTransaction(async (client) => {
    const selected = await client.query<{ run_id: string; payload_json: TaskExecutionJob }>(
      `SELECT d.run_id, d.payload_json FROM task_run_dispatches d
       JOIN task_runs tr ON tr.id = d.run_id AND tr.ended_at IS NULL
       JOIN tasks t ON t.id = d.task_id
       WHERE t.cancellation_requested
         AND (d.queue_state IN ('pending', 'cancelled') OR
           (d.queue_state = 'admitted' AND d.payload_json->'executionTarget'->>'kind' = 'local'
             AND d.lease_device_id IS NULL))
         AND NOT EXISTS (SELECT 1 FROM task_runs newer
           WHERE newer.task_id = t.id AND newer.attempt_no > tr.attempt_no)
       ORDER BY d.run_id LIMIT 100 FOR UPDATE OF t, d SKIP LOCKED`
    );
    if (selected.rows.length) await client.query(
      `UPDATE task_run_dispatches SET queue_state = 'cancelled', finished_at = now(),
         lease_epoch = lease_epoch + 1, lease_device_id = NULL, lease_holder = NULL,
         lease_api_url = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE run_id = ANY($1::uuid[])`, [selected.rows.map((row) => row.run_id)]
    );
    return selected.rows.map((row) => row.payload_json);
  });
  // Cancelled dispatches with an open run stay eligible above if this worker exits before
  // settling them. Continuation allocation rechecks the interrupt and run ownership under lock.
  for (const job of jobs) {
    await handleCancelledRun(job);
    await finishFailedLaneRun(job, "cancelled", true);
  }
  return jobs.length;
}
