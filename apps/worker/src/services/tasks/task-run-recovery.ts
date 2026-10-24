import {
  buildTaskRunQueueJobId,
  type TaskExecutionJob,
  type TaskRunDispatchQueueState,
  type TaskSource,
  isLocalTaskExecutionTarget,
  normalizeTaskExecutionTarget,
  type TaskExecutionTarget,
  LOCAL_RUN_MAX_PENDING_MS
} from "@meowbert/shared";
import type { JobType } from "bullmq";
import { query, withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { emitTaskEvent } from "../runtime/events.js";
import { resolveContinuationBranchMessageId, resolveLatestBranchSelectionUserId } from "../agent-db/index.js";
import { markTaskRunDispatchPending } from "./task-run-dispatch.js";
import { shouldResolveContinuationBranch } from "./task-run-utils.js";

const RECOVERY_INTERVAL_MS = 12_000;
const RECOVERY_BATCH_SIZE = 100;
const LIVE_QUEUE_STATE_LIST: JobType[] = [
  "waiting",
  "active",
  "delayed",
  "paused",
  "prioritized",
  "waiting-children"
];
const LIVE_QUEUE_STATES = new Set<JobType>(LIVE_QUEUE_STATE_LIST);
const LOCAL_CLAIM_WINDOW_MS = 60_000;
const LOCAL_LEASE_RECLAIM_GRACE_MS = 30_000;

interface RecoverableTaskRunRow {
  task_id: string;
  run_id: string;
  run_kind: TaskExecutionJob["mode"];
  workspace_id: string;
  environment_id: string;
  source: string;
  dispatch_queue_state: TaskRunDispatchQueueState | null;
  execution_target: TaskExecutionTarget | null;
}

const recoveryCursors: Record<"queued" | "running", string | null> = { queued: null, running: null };

function isLiveQueueState(state: string): boolean {
  return LIVE_QUEUE_STATES.has(state as JobType);
}

function normalizeTaskSource(rawSource: string): TaskSource {
  if (rawSource === "telegram" || rawSource === "discord" || rawSource === "github" || rawSource === "email") {
    return rawSource;
  }

  return "web";
}

function isDuplicateJobError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const lowerMessage = error.message.toLowerCase();
  return lowerMessage.includes("jobid") && lowerMessage.includes("exist");
}

async function hasLiveQueueJob(row: RecoverableTaskRunRow, knownLiveJobs: Set<string>): Promise<boolean> {
  const jobId = buildTaskRunQueueJobId(row.task_id, row.run_id);
  const legacyJobName = `task:${row.task_id}:run:${row.run_id}`;
  if (knownLiveJobs.has(jobId) || knownLiveJobs.has(legacyJobName)) {
    return true;
  }

  const existing = (await taskQueue.getJob(jobId)) ?? (await taskQueue.getJob(legacyJobName));
  if (existing) {
    const state = await existing.getState();
    if (isLiveQueueState(state)) {
      knownLiveJobs.add(String(existing.id));
      knownLiveJobs.add(existing.name);
      return true;
    }

    if (state === "completed" || state === "failed") {
      await existing.remove().catch(() => undefined);
    }
  }

  return false;
}

async function ensureRunQueued(row: RecoverableTaskRunRow, knownLiveJobs: Set<string>): Promise<boolean> {
  if (await hasLiveQueueJob(row, knownLiveJobs)) {
    return false;
  }

  const jobId = buildTaskRunQueueJobId(row.task_id, row.run_id);
  let selectionUserId: string | null = null;
  let branchMessageId: string | null = null;
  if (shouldResolveContinuationBranch(row.run_kind)) {
    selectionUserId = await resolveLatestBranchSelectionUserId(row.task_id);
    branchMessageId = await resolveContinuationBranchMessageId(row.task_id, selectionUserId ?? undefined);
  }

  const payload: TaskExecutionJob = {
    taskId: row.task_id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    environmentId: row.environment_id,
    triggerSource: normalizeTaskSource(row.source),
    mode: row.run_kind ?? "default",
    branchMessageId: branchMessageId ?? undefined,
    selectionUserId: selectionUserId ?? undefined
  };

  const target = normalizeTaskExecutionTarget(row.execution_target);
  if (isLocalTaskExecutionTarget(target)) {
    payload.executionTarget = target;
    const restored = await query(
      `INSERT INTO task_run_dispatches (run_id, task_id, workspace_id, environment_id, dispatch_class, payload_json)
       VALUES ($1, $2, $3, $4, 'interactive_followup', $5::jsonb) ON CONFLICT (run_id) DO NOTHING`,
      [row.run_id, row.task_id, row.workspace_id, row.environment_id, JSON.stringify(payload)]
    );
    return (restored.rowCount ?? 0) > 0;
  }

  try {
    await taskQueue.add(jobId, payload, {
      jobId,
      attempts: 1,
      removeOnComplete: 200,
      removeOnFail: 200
    });
    knownLiveJobs.add(jobId);
    return true;
  } catch (error) {
    if (isDuplicateJobError(error)) {
      return false;
    }

    throw error;
  }
}

async function ensureSchedulerManagedRunPending(
  row: RecoverableTaskRunRow,
  knownLiveJobs: Set<string>
): Promise<boolean> {
  if (isLocalTaskExecutionTarget(normalizeTaskExecutionTarget(row.execution_target))) {
    return false;
  }
  if (await hasLiveQueueJob(row, knownLiveJobs)) {
    return false;
  }

  if (!row.dispatch_queue_state || row.dispatch_queue_state === "pending" || row.dispatch_queue_state === "cancelled") {
    return false;
  }

  await markTaskRunDispatchPending(row.run_id);
  return true;
}

async function markStaleActiveTaskQueued(row: RecoverableTaskRunRow, knownLiveJobs: Set<string>): Promise<boolean> {
  if (isLocalTaskExecutionTarget(normalizeTaskExecutionTarget(row.execution_target))) {
    return false;
  }
  if (await hasLiveQueueJob(row, knownLiveJobs)) {
    return false;
  }

  const promoted = await withTransaction(async (client) => {
    const taskRes = await client.query<{ status: string }>(
      `SELECT status
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [row.task_id]
    );
    if (
      (taskRes.rowCount ?? 0) === 0
      || (taskRes.rows[0].status !== "running" && taskRes.rows[0].status !== "starting")
    ) {
      return false;
    }

    const runRes = await client.query<{ id: string }>(
      `SELECT id
         FROM task_runs
        WHERE task_id = $1
          AND ended_at IS NULL
        ORDER BY attempt_no DESC
        LIMIT 1
        FOR UPDATE`,
      [row.task_id]
    );
    if ((runRes.rowCount ?? 0) === 0 || runRes.rows[0].id !== row.run_id) {
      return false;
    }

    await client.query(
      `UPDATE tasks
          SET status = 'queued',
              updated_at = now()
        WHERE id = $1`,
      [row.task_id]
    );

    if (row.dispatch_queue_state && row.dispatch_queue_state !== "cancelled") {
      await client.query(
        `UPDATE task_run_dispatches
            SET queue_state = 'pending',
                admitted_at = NULL,
                started_at = NULL,
                finished_at = NULL,
                updated_at = now()
          WHERE run_id = $1`,
        [row.run_id]
      );
    }

    return true;
  });

  if (!promoted) {
    return false;
  }

  await emitTaskEvent(row.task_id, "status", { status: "queued" }).catch((error) => {
    console.warn(`Failed to emit queued status while recovering active task ${row.task_id}`, error);
  });
  await emitTaskEvent(row.task_id, "log", {
    message: "Recovered after deployment restart; resuming task execution.",
    recoveryReason: "worker_restart",
    recoveredRunId: row.run_id
  }).catch((error) => {
    console.warn(`Failed to emit recovery log while recovering active task ${row.task_id}`, error);
  });

  return true;
}

export async function recoverQueuedTaskRunsOnce(knownLiveJobs?: Set<string>): Promise<number> {
  const liveJobLookup = knownLiveJobs ?? new Set<string>();

  const queuedRuns = await query<RecoverableTaskRunRow>(
    `SELECT
        t.id AS task_id,
        latest_run.id AS run_id,
        latest_run.run_kind,
        t.workspace_id,
        t.environment_id,
        t.source,
        d.queue_state AS dispatch_queue_state,
        t.execution_target
       FROM tasks t
       JOIN LATERAL (
         SELECT tr.id, tr.run_kind
           FROM task_runs tr
          WHERE tr.task_id = t.id
            AND tr.ended_at IS NULL
          ORDER BY tr.attempt_no DESC
          LIMIT 1
      ) AS latest_run ON true
      LEFT JOIN task_run_dispatches d
        ON d.run_id = latest_run.id
      WHERE t.status = 'queued'
        AND t.trashed_at IS NULL
        AND ($2::uuid IS NULL OR t.id > $2::uuid)
      ORDER BY t.id ASC
      LIMIT $1`,
    [RECOVERY_BATCH_SIZE, recoveryCursors.queued]
  );

  recoveryCursors.queued = queuedRuns.rows.length === RECOVERY_BATCH_SIZE
    ? queuedRuns.rows[queuedRuns.rows.length - 1].task_id : null;
  let recoveredCount = 0;
  for (const row of queuedRuns.rows) {
    const requeued = row.dispatch_queue_state !== null
      ? await ensureSchedulerManagedRunPending(row, liveJobLookup)
      : await ensureRunQueued(row, liveJobLookup);
    if (requeued) {
      recoveredCount += 1;
    }
  }

  return recoveredCount;
}

export async function recoverRunningTaskRunsOnce(knownLiveJobs?: Set<string>): Promise<number> {
  const liveJobLookup = knownLiveJobs ?? new Set<string>();

  const runningRuns = await query<RecoverableTaskRunRow>(
    `SELECT
        t.id AS task_id,
        latest_run.id AS run_id,
        latest_run.run_kind,
        t.workspace_id,
        t.environment_id,
        t.source,
        d.queue_state AS dispatch_queue_state,
        t.execution_target
       FROM tasks t
       JOIN LATERAL (
         SELECT tr.id, tr.run_kind
           FROM task_runs tr
          WHERE tr.task_id = t.id
            AND tr.ended_at IS NULL
          ORDER BY tr.attempt_no DESC
          LIMIT 1
      ) AS latest_run ON true
      LEFT JOIN task_run_dispatches d
        ON d.run_id = latest_run.id
      WHERE t.status IN ('starting', 'running')
        AND t.trashed_at IS NULL
        AND ($2::uuid IS NULL OR t.id > $2::uuid)
      ORDER BY t.id ASC
      LIMIT $1`,
    [RECOVERY_BATCH_SIZE, recoveryCursors.running]
  );

  recoveryCursors.running = runningRuns.rows.length === RECOVERY_BATCH_SIZE
    ? runningRuns.rows[runningRuns.rows.length - 1].task_id : null;
  let recoveredCount = 0;
  for (const row of runningRuns.rows) {
    const promoted = await markStaleActiveTaskQueued(row, liveJobLookup);
    if (promoted) {
      recoveredCount += 1;
    }
  }

  return recoveredCount;
}

/** Releases a local admission after the device has missed its claim window or lease grace. */
export async function reclaimExpiredLocalRunLeasesOnce(): Promise<number> {
  const result = await query<{ run_id: string }>(
    `WITH expired AS (
       SELECT d.run_id, d.task_id, t.cancellation_requested, t.trashed_at
         FROM task_run_dispatches d JOIN tasks t ON t.id = d.task_id
         JOIN task_runs tr ON tr.id = d.run_id AND tr.ended_at IS NULL
        WHERE d.payload_json->'executionTarget'->>'kind' = 'local'
          AND NOT EXISTS (SELECT 1 FROM task_runs newer WHERE newer.task_id = t.id AND newer.attempt_no > tr.attempt_no)
          AND ((d.queue_state = 'admitted' AND d.admitted_at < now() - ($1::double precision * interval '1 millisecond'))
            OR (d.queue_state = 'running' AND COALESCE(d.lease_expires_at, d.started_at) < now() - ($2::double precision * interval '1 millisecond')))
        FOR UPDATE OF d, t SKIP LOCKED
     ), released AS (
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
     UPDATE tasks t SET status = CASE WHEN r.queue_state = 'cancelled' THEN 'cancelled' ELSE 'queued' END, updated_at = now()
       FROM released r WHERE t.id = r.task_id RETURNING r.run_id`,
    [LOCAL_CLAIM_WINDOW_MS, LOCAL_LEASE_RECLAIM_GRACE_MS]
  );
  return result.rowCount ?? 0;
}

export async function expireUnavailableLocalRunsOnce(): Promise<number> {
  const result = await query(
    `WITH expired AS (
       SELECT d.run_id, d.task_id, t.cancellation_requested
         FROM task_run_dispatches d JOIN tasks t ON t.id = d.task_id
         JOIN task_runs tr ON tr.id = d.run_id AND tr.ended_at IS NULL
        WHERE d.payload_json->'executionTarget'->>'kind' = 'local' AND d.queue_state = 'pending'
          AND t.status = 'queued' AND d.eligible_at < now() - ($1::double precision * interval '1 millisecond')
        FOR UPDATE OF d, t SKIP LOCKED
     ), finished AS (
       UPDATE task_run_dispatches d SET queue_state = 'finished', finished_at = now(), pending_reason = NULL
       FROM expired e WHERE d.run_id = e.run_id RETURNING d.run_id
     ), ended AS (
       UPDATE task_runs tr SET ended_at = now(), exit_reason = 'device_unavailable',
         error_summary = 'The local device was unavailable for 24 hours.'
       FROM expired e WHERE tr.id = e.run_id RETURNING tr.id
     ) UPDATE tasks t SET status = CASE WHEN e.cancellation_requested THEN 'cancelled' ELSE 'failed' END,
       completed_at = now(), updated_at = now() FROM expired e WHERE t.id = e.task_id RETURNING t.id`,
    [LOCAL_RUN_MAX_PENDING_MS]
  );
  return result.rowCount ?? 0;
}

export function startTaskRunRecoveryLoop(): { stop: () => Promise<void> } {
  let stopping = false;
  let running = false;
  let interval: NodeJS.Timeout | null = null;
  let pendingRun: Promise<void> | null = null;

  const runOnce = async (): Promise<void> => {
    if (stopping || running) {
      return;
    }

    running = true;
    pendingRun = (async () => {
      const reclaimedLocalCount = await reclaimExpiredLocalRunLeasesOnce();
      await expireUnavailableLocalRunsOnce();
      const liveJobLookup = new Set<string>();
      const recoveredRunningCount = await recoverRunningTaskRunsOnce(liveJobLookup);
      const recoveredQueuedCount = await recoverQueuedTaskRunsOnce(liveJobLookup);
      const recoveredCount = recoveredRunningCount + recoveredQueuedCount;
      if (recoveredCount > 0 || reclaimedLocalCount > 0) {
        console.log(
          `Recovered ${recoveredCount} task run(s) (${recoveredRunningCount} running->queued, ${recoveredQueuedCount} re-enqueued); reclaimed ${reclaimedLocalCount} local run(s)`
        );
      }
    })()
      .catch((error) => {
        console.error("Failed to recover task runs", error);
      })
      .finally(() => {
        running = false;
        pendingRun = null;
      });

    await pendingRun;
  };

  void runOnce();
  interval = setInterval(() => {
    void runOnce();
  }, RECOVERY_INTERVAL_MS);

  return {
    stop: async (): Promise<void> => {
      stopping = true;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (pendingRun) {
        await pendingRun;
      }
    }
  };
}
