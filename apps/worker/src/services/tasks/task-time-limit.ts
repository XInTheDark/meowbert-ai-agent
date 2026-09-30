import { buildTaskRunQueueJobId } from "@meowbert/shared";
import type { JobType } from "bullmq";
import { query, withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { emitTaskEvent } from "../runtime/events.js";

const TASK_TIME_LIMIT_INTERVAL_MS = 5_000;
const TASK_TIME_LIMIT_BATCH_SIZE = 100;
const ACTIVE_TASK_STATUSES = new Set(["queued", "starting", "running", "awaiting_input"]);
const REMOVABLE_PENDING_JOB_STATES = new Set<JobType>([
  "waiting",
  "delayed",
  "paused",
  "prioritized",
  "waiting-children"
]);
const TIME_LIMIT_CANCEL_MESSAGE = "Task cancelled because its time limit expired.";

interface ExpiredTaskScopeRow {
  root_task_id: string;
}

interface TaskScopeRow {
  id: string;
  status: string;
  time_limit_deadline_at: string | null;
}

interface OpenRunRow {
  run_id: string;
  task_id: string;
}

interface ExpiredTaskScopeCancellation {
  runningTaskIds: string[];
  cancelledTaskIds: string[];
  openRunsToRemove: OpenRunRow[];
}

function isExpiredDeadline(rawDeadlineAt: string | null, nowMs: number): boolean {
  if (!rawDeadlineAt) {
    return false;
  }

  const deadlineAtMs = new Date(rawDeadlineAt).getTime();
  return Number.isFinite(deadlineAtMs) && deadlineAtMs <= nowMs;
}

async function removePendingRunJob(taskId: string, runId: string): Promise<void> {
  const job = await taskQueue.getJob(buildTaskRunQueueJobId(taskId, runId));
  if (!job) {
    return;
  }

  const state = await job.getState();
  if (!REMOVABLE_PENDING_JOB_STATES.has(state as JobType)) {
    return;
  }

  await job.remove().catch(() => undefined);
}

async function cancelExpiredTaskScope(rootTaskId: string, nowMs: number): Promise<ExpiredTaskScopeCancellation | null> {
  return withTransaction(async (client) => {
    const scopeRes = await client.query<TaskScopeRow>(
      `SELECT id, status, time_limit_deadline_at
         FROM tasks
        WHERE id = $1
           OR workflow_parent_task_id = $1
        FOR UPDATE`,
      [rootTaskId]
    );

    if ((scopeRes.rowCount ?? 0) === 0) {
      return null;
    }

    const activeTasks = scopeRes.rows.filter((row) => ACTIVE_TASK_STATUSES.has(row.status));
    if (activeTasks.length === 0) {
      return null;
    }

    const hasExpiredTaskInScope = activeTasks.some((row) => isExpiredDeadline(row.time_limit_deadline_at, nowMs));
    if (!hasExpiredTaskInScope) {
      return null;
    }

    const targetTaskIds = activeTasks.map((row) => row.id);
    const runningTaskIds = activeTasks
      .filter((row) => row.status === "running" || row.status === "starting")
      .map((row) => row.id);
    const cancelledTaskIds = activeTasks
      .filter((row) => row.status !== "running" && row.status !== "starting")
      .map((row) => row.id);

    await client.query(
      `UPDATE tasks
          SET cancellation_requested = true,
              resume_after_interrupt = false,
              status = CASE WHEN id = ANY($2::uuid[]) THEN status ELSE 'cancelled' END,
              completed_at = CASE WHEN id = ANY($2::uuid[]) THEN completed_at ELSE now() END,
              updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [targetTaskIds, runningTaskIds]
    );

    await client.query(
      `UPDATE task_schedules
          SET schedule_state = 'cancelled',
              next_run_at = NULL,
              run_deadline_at = NULL,
              pending_run = false,
              cancelled_at = COALESCE(cancelled_at, now()),
              updated_at = now()
        WHERE task_id = ANY($1::uuid[])`,
      [targetTaskIds]
    );

    const openRunsToRemoveRes = cancelledTaskIds.length > 0
      ? await client.query<OpenRunRow>(
        `SELECT id AS run_id, task_id
           FROM task_runs
          WHERE task_id = ANY($1::uuid[])
            AND ended_at IS NULL
          FOR UPDATE`,
        [cancelledTaskIds]
      )
      : { rows: [] as OpenRunRow[] };

    if (openRunsToRemoveRes.rows.length > 0) {
      await client.query(
        `UPDATE task_runs
            SET ended_at = now(),
                exit_reason = 'cancelled'
          WHERE id = ANY($1::uuid[])`,
        [openRunsToRemoveRes.rows.map((row) => row.run_id)]
      );
    }

    return {
      runningTaskIds,
      cancelledTaskIds,
      openRunsToRemove: openRunsToRemoveRes.rows
    };
  });
}

async function emitScopeCancellationEvents(input: ExpiredTaskScopeCancellation): Promise<void> {
  for (const taskId of input.runningTaskIds) {
    await emitTaskEvent(taskId, "log", { message: TIME_LIMIT_CANCEL_MESSAGE }).catch((error) => {
      console.warn(`[time-limit] Failed to emit running-task timeout log for ${taskId}`, error);
    });
  }

  for (const taskId of input.cancelledTaskIds) {
    await emitTaskEvent(taskId, "status", { status: "cancelled" }).catch((error) => {
      console.warn(`[time-limit] Failed to emit cancelled status for ${taskId}`, error);
    });
    await emitTaskEvent(taskId, "log", { message: TIME_LIMIT_CANCEL_MESSAGE }).catch((error) => {
      console.warn(`[time-limit] Failed to emit timeout log for ${taskId}`, error);
    });
  }
}

export async function runTaskTimeLimitSweepOnce(): Promise<number> {
  const nowMs = Date.now();
  const expiredScopesRes = await query<ExpiredTaskScopeRow>(
    `SELECT DISTINCT COALESCE(workflow_parent_task_id, id) AS root_task_id
       FROM tasks
      WHERE time_limit_deadline_at IS NOT NULL
        AND time_limit_deadline_at <= now()
        AND status IN ('queued', 'starting', 'running', 'awaiting_input')
      ORDER BY root_task_id
      LIMIT $1`,
    [TASK_TIME_LIMIT_BATCH_SIZE]
  );

  let cancelledScopeCount = 0;

  for (const row of expiredScopesRes.rows) {
    const cancellation = await cancelExpiredTaskScope(row.root_task_id, nowMs);
    if (!cancellation) {
      continue;
    }

    await Promise.all(
      cancellation.openRunsToRemove.map((openRun) => removePendingRunJob(openRun.task_id, openRun.run_id))
    );
    await emitScopeCancellationEvents(cancellation);
    cancelledScopeCount += 1;
  }

  return cancelledScopeCount;
}

export function startTaskTimeLimitLoop(): { stop: () => Promise<void> } {
  let stopping = false;
  let running = false;
  let interval: NodeJS.Timeout | null = null;
  let pendingRun: Promise<void> | null = null;

  const runOnce = async (): Promise<void> => {
    if (stopping || running) {
      return;
    }

    running = true;
    pendingRun = runTaskTimeLimitSweepOnce()
      .then((cancelledScopeCount) => {
        if (cancelledScopeCount > 0) {
          console.log(`[time-limit] Cancelled ${cancelledScopeCount} expired task scope(s)`);
        }
      })
      .catch((error) => {
        console.error("[time-limit] Task time-limit loop failed", error);
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
  }, TASK_TIME_LIMIT_INTERVAL_MS);

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
