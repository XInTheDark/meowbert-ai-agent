import {
  buildTaskRunQueueJobId,
  type TaskExecutionJob,
  type TaskRunDispatchQueueState,
  type TaskSource
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

interface RecoverableTaskRunRow {
  task_id: string;
  run_id: string;
  run_kind: TaskExecutionJob["mode"];
  workspace_id: string;
  environment_id: string;
  source: string;
  dispatch_queue_state: TaskRunDispatchQueueState | null;
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
        d.queue_state AS dispatch_queue_state
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
        d.queue_state AS dispatch_queue_state
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
      const liveJobLookup = new Set<string>();
      const recoveredRunningCount = await recoverRunningTaskRunsOnce(liveJobLookup);
      const recoveredQueuedCount = await recoverQueuedTaskRunsOnce(liveJobLookup);
      const recoveredCount = recoveredRunningCount + recoveredQueuedCount;
      if (recoveredCount > 0) {
        console.log(
          `Recovered ${recoveredCount} task run(s) (${recoveredRunningCount} running->queued, ${recoveredQueuedCount} re-enqueued)`
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
