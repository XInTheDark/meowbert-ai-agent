import type { PoolClient } from "pg";

// A local run that no device holds has nothing to interrupt, so a stop ends it at once instead of
// waiting for a device to refuse the claim and the lease sweep to notice. Swarm lanes are left to
// the worker sweep, which also settles the lane.
export async function cancelUnclaimedLocalRunsInTx(client: PoolClient, taskIds: string[]): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const result = await client.query<{ task_id: string }>(
    `WITH unclaimed AS (
       SELECT d.run_id, d.task_id
         FROM task_run_dispatches d
         JOIN task_runs tr ON tr.id = d.run_id AND tr.ended_at IS NULL
        WHERE d.task_id = ANY($1::uuid[])
          AND d.payload_json->'executionTarget'->>'kind' = 'local'
          AND d.queue_state IN ('pending', 'admitted')
          AND d.lease_device_id IS NULL
          AND d.lease_holder IS NULL
          AND NOT EXISTS (SELECT 1 FROM task_swarm_lanes lane WHERE lane.task_id = d.task_id)
          AND NOT EXISTS (SELECT 1 FROM task_runs newer WHERE newer.task_id = tr.task_id AND newer.attempt_no > tr.attempt_no)
        FOR UPDATE OF d, tr
     ), cancelled_dispatches AS (
       UPDATE task_run_dispatches d
          SET queue_state = 'cancelled', pending_reason = NULL, admitted_at = NULL,
              lease_epoch = d.lease_epoch + 1, finished_at = now(), updated_at = now()
         FROM unclaimed u WHERE d.run_id = u.run_id
     ), ended_runs AS (
       UPDATE task_runs tr SET ended_at = now(), exit_reason = 'cancelled'
         FROM unclaimed u WHERE tr.id = u.run_id
     )
     UPDATE tasks t
        SET status = 'cancelled', completed_at = now(), updated_at = now()
       FROM unclaimed u
      WHERE t.id = u.task_id AND t.status IN ('queued', 'starting', 'running')
     RETURNING t.id AS task_id`,
    [taskIds]
  );
  return result.rows.map((row) => row.task_id);
}
