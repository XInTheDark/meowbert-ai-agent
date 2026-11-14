import type { PoolClient } from "pg";
import { LOCAL_RUN_MAX_PENDING_MS, normalizeAgentSwarmSettings } from "@meowbert/shared";
import { buildUnsubmittedLaneResult } from "@meowbert/run-executor/agent-swarm/forced-submit";
import { query, withTransaction } from "../../lib/db.js";
import { wakeParentIfBarrierMetInTx } from "../agent-swarm/barrier.js";
import { dropDiscardedResultInTx, loadLane, setLaneStatusInTx } from "../agent-swarm/lane-store.js";
import { lockSwarmInTx, startQueuedLanesInTx } from "../agent-swarm/scheduler.js";

const LOCAL_CLAIM_WINDOW_MS = 60_000;
const LOCAL_LEASE_RECLAIM_GRACE_MS = 30_000;
const UNAVAILABLE_MESSAGE = "The local device was unavailable for 24 hours.";

interface RecoveryCandidate {
  run_id: string;
  task_id: string;
  swarm_task_id: string | null;
  parent_task_id: string | null;
}

// Select without locks, then take the swarm and parent locks before the recovery updates take the
// lane task/dispatch locks. Recheck eligibility under those locks, including the latest attempt.
async function recoverLocalRuns(input: {
  predicate: string;
  params: unknown[];
  update: string;
}): Promise<number> {
  const selection = `SELECT d.run_id, d.task_id, t.cancellation_requested, t.trashed_at
    FROM task_run_dispatches d JOIN tasks t ON t.id = d.task_id
    JOIN task_runs tr ON tr.id = d.run_id AND tr.ended_at IS NULL
    WHERE d.payload_json->'executionTarget'->>'kind' = 'local'
      AND NOT EXISTS (SELECT 1 FROM task_runs newer WHERE newer.task_id = t.id AND newer.attempt_no > tr.attempt_no)
      AND (${input.predicate})`;
  const candidates = await query<RecoveryCandidate>(
    `SELECT eligible.run_id, eligible.task_id, lane.swarm_task_id, lane.parent_task_id
       FROM (${selection}) eligible
       LEFT JOIN task_swarm_lanes lane ON lane.task_id = eligible.task_id
      ORDER BY eligible.run_id LIMIT 100`,
    input.params
  );
  let count = 0;
  for (const candidate of candidates.rows) {
    count += await withTransaction(async (client) => {
      const swarm = candidate.swarm_task_id ? await lockSwarmInTx(client, candidate.swarm_task_id) : null;
      if (candidate.parent_task_id) {
        await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [candidate.parent_task_id]);
      }
      const recovered = await client.query<{ status: string }>(
        `WITH expired AS (${selection} AND d.run_id = $${input.params.length + 1}::uuid
           FOR UPDATE OF d, t SKIP LOCKED), ${input.update}`,
        [...input.params, candidate.run_id]
      );
      const status = recovered.rows[0]?.status;
      if (swarm && (status === "failed" || status === "cancelled")) {
        await settleRecoveredLaneInTx(client, candidate.task_id, status, swarm.config_json);
      }
      return recovered.rowCount ?? 0;
    });
  }
  return count;
}

async function settleRecoveredLaneInTx(client: PoolClient, taskId: string, status: string, config: unknown): Promise<void> {
  const lane = await loadLane(client, taskId, { forUpdate: true });
  if (!lane || !["running", "waiting"].includes(lane.status)) return;
  const cancelled = status === "cancelled";
  await setLaneStatusInTx(client, taskId, cancelled ? "stopped" : "failed", {
    result: buildUnsubmittedLaneResult(cancelled ? "Stopped and discarded." : `The lane failed: ${UNAVAILABLE_MESSAGE}`)
  });
  if (cancelled) await dropDiscardedResultInTx(client, lane);
  await startQueuedLanesInTx(client, lane.swarm_task_id, normalizeAgentSwarmSettings(config).advanced.maxRunningLanes);
  await wakeParentIfBarrierMetInTx(client, lane.parent_task_id);
}

/** Releases a local admission after the device has missed its claim window or lease grace, and
 * ends at once any run of a stopped task that no device holds. */
export async function reclaimExpiredLocalRunLeasesOnce(): Promise<number> {
  return recoverLocalRuns({
    predicate: `(d.queue_state = 'admitted' AND d.admitted_at < now() - ($1::double precision * interval '1 millisecond'))
      OR (d.queue_state = 'running' AND COALESCE(d.lease_expires_at, d.started_at) < now() - ($2::double precision * interval '1 millisecond'))
      OR (d.queue_state IN ('pending', 'admitted') AND d.lease_device_id IS NULL
        AND ((t.cancellation_requested AND NOT t.resume_after_interrupt) OR t.trashed_at IS NOT NULL))`,
    params: [LOCAL_CLAIM_WINDOW_MS, LOCAL_LEASE_RECLAIM_GRACE_MS],
    update: `released AS (
       UPDATE task_run_dispatches d SET
         queue_state = CASE WHEN e.cancellation_requested OR e.trashed_at IS NOT NULL THEN 'cancelled' ELSE 'pending' END,
         lease_epoch = lease_epoch + 1, lease_device_id = NULL, lease_holder = NULL,
         lease_api_url = NULL, lease_expires_at = NULL, pending_reason = 'device_offline',
         admitted_at = NULL, started_at = NULL, eligible_at = now(), updated_at = now()
       FROM expired e WHERE d.run_id = e.run_id RETURNING d.run_id, d.task_id, d.queue_state
     ), ended AS (
       UPDATE task_runs tr SET ended_at = now(), exit_reason = 'cancelled'
       FROM released r WHERE tr.id = r.run_id AND r.queue_state = 'cancelled' RETURNING tr.id
     )
     UPDATE tasks t SET status = CASE WHEN r.queue_state = 'cancelled' THEN 'cancelled' ELSE 'queued' END,
       completed_at = CASE WHEN r.queue_state = 'cancelled' THEN now() ELSE t.completed_at END, updated_at = now()
       FROM released r WHERE t.id = r.task_id RETURNING t.status`
  });
}

export async function expireUnavailableLocalRunsOnce(): Promise<number> {
  return recoverLocalRuns({
    predicate: `d.queue_state = 'pending' AND t.status = 'queued'
      AND d.eligible_at < now() - ($1::double precision * interval '1 millisecond')`,
    params: [LOCAL_RUN_MAX_PENDING_MS],
    update: `finished AS (
       UPDATE task_run_dispatches d SET queue_state = 'finished', finished_at = now(), pending_reason = NULL
       FROM expired e WHERE d.run_id = e.run_id RETURNING d.run_id
     ), ended AS (
       UPDATE task_runs tr SET ended_at = now(), exit_reason = 'device_unavailable',
         error_summary = '${UNAVAILABLE_MESSAGE}'
       FROM expired e WHERE tr.id = e.run_id RETURNING tr.id
     ) UPDATE tasks t SET status = CASE WHEN e.cancellation_requested OR e.trashed_at IS NOT NULL THEN 'cancelled' ELSE 'failed' END,
       completed_at = now(), updated_at = now() FROM expired e WHERE t.id = e.task_id RETURNING t.status`
  });
}
