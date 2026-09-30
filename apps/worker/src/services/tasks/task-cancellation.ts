import { buildTaskRunQueueJobId, type TaskStatus } from "@meowbert/shared";
import type { JobType } from "bullmq";
import { query, withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { emitTaskEvent } from "../runtime/events.js";
import { markTaskRunDispatchesCancelled } from "./task-run-dispatch.js";

const ACTIVE_TASK_STATUSES: TaskStatus[] = ["queued", "starting", "running", "awaiting_input"];
const ACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(ACTIVE_TASK_STATUSES);
const REMOVABLE_PENDING_JOB_STATES = new Set<JobType>([
  "waiting",
  "delayed",
  "paused",
  "prioritized",
  "waiting-children"
]);
const TASK_CANCELLATION_WAIT_INTERVAL_MS = 500;
const DEFAULT_TASK_CANCELLATION_WAIT_TIMEOUT_MS = 120_000;
type TaskCancellationTimeoutBehavior = "continue" | "error";

interface TaskScopeRow {
  id: string;
  status: TaskStatus;
}

interface OpenRunRow {
  run_id: string;
  task_id: string;
}

interface TaskScopeCancellation {
  runningTaskIds: string[];
  cancelledTaskIds: string[];
  openRunsToRemove: OpenRunRow[];
}

export interface WorkspaceTaskCancellationResult {
  cancelledScopeCount: number;
  runningTaskCount: number;
  cancelledTaskCount: number;
  waitTimedOut: boolean;
  remainingActiveTaskCount: number;
}

function buildEmptyWorkspaceTaskCancellationResult(): WorkspaceTaskCancellationResult {
  return {
    cancelledScopeCount: 0,
    runningTaskCount: 0,
    cancelledTaskCount: 0,
    waitTimedOut: false,
    remainingActiveTaskCount: 0
  };
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

async function cancelTaskScope(rootTaskId: string): Promise<TaskScopeCancellation | null> {
  return withTransaction(async (client) => {
    const scopeRes = await client.query<TaskScopeRow>(
      `SELECT id, status
         FROM tasks
        WHERE id = $1
           OR workflow_parent_task_id = $1
        FOR UPDATE`,
      [rootTaskId]
    );

    if ((scopeRes.rowCount ?? 0) === 0) {
      return null;
    }

    const activeTasks = scopeRes.rows.filter((row) => ACTIVE_TASK_STATUS_SET.has(row.status));
    if (activeTasks.length === 0) {
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

async function emitTaskCancellationEvents(input: TaskScopeCancellation, message: string): Promise<void> {
  for (const taskId of input.runningTaskIds) {
    await emitTaskEvent(taskId, "log", { message }).catch((error) => {
      console.warn(`[task-cancellation] Failed to emit running-task cancellation log for ${taskId}`, error);
    });
  }

  for (const taskId of input.cancelledTaskIds) {
    await emitTaskEvent(taskId, "status", { status: "cancelled" }).catch((error) => {
      console.warn(`[task-cancellation] Failed to emit cancelled status for ${taskId}`, error);
    });
    await emitTaskEvent(taskId, "log", { message }).catch((error) => {
      console.warn(`[task-cancellation] Failed to emit cancellation log for ${taskId}`, error);
    });
  }
}

async function listActiveTaskScopeIdsForWorkspaces(workspaceIds: string[]): Promise<string[]> {
  if (workspaceIds.length === 0) {
    return [];
  }

  const result = await query<{ root_task_id: string }>(
    `SELECT DISTINCT COALESCE(workflow_parent_task_id, id) AS root_task_id
       FROM tasks
      WHERE workspace_id = ANY($1::uuid[])
        AND status = ANY($2::text[])`,
    [workspaceIds, ACTIVE_TASK_STATUSES]
  );

  return result.rows.map((row) => row.root_task_id);
}

async function countActiveTasksForWorkspaces(workspaceIds: string[]): Promise<number> {
  if (workspaceIds.length === 0) {
    return 0;
  }

  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM tasks
      WHERE workspace_id = ANY($1::uuid[])
        AND status = ANY($2::text[])`,
    [workspaceIds, ACTIVE_TASK_STATUSES]
  );

  return Number(result.rows[0]?.count ?? 0);
}

async function waitForNoActiveTasksForWorkspaces(input: {
  workspaceIds: string[];
  timeoutMs?: number;
}): Promise<boolean> {
  const deadlineAt = Date.now() + (input.timeoutMs ?? DEFAULT_TASK_CANCELLATION_WAIT_TIMEOUT_MS);

  while (Date.now() <= deadlineAt) {
    if ((await countActiveTasksForWorkspaces(input.workspaceIds)) === 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, TASK_CANCELLATION_WAIT_INTERVAL_MS));
  }

  return (await countActiveTasksForWorkspaces(input.workspaceIds)) === 0;
}

export async function ensureNoActiveTasksForWorkspaces(input: {
  workspaceIds: string[];
  cancellationMessage: string;
  timeoutMs?: number;
  timeoutBehavior?: TaskCancellationTimeoutBehavior;
}): Promise<WorkspaceTaskCancellationResult> {
  const workspaceIds = Array.from(new Set(input.workspaceIds.map((value) => value.trim()).filter((value) => value.length > 0)));
  if (workspaceIds.length === 0) {
    return buildEmptyWorkspaceTaskCancellationResult();
  }

  if ((await countActiveTasksForWorkspaces(workspaceIds)) === 0) {
    return buildEmptyWorkspaceTaskCancellationResult();
  }

  const scopeIds = await listActiveTaskScopeIdsForWorkspaces(workspaceIds);
  let cancelledScopeCount = 0;
  let runningTaskCount = 0;
  let cancelledTaskCount = 0;

  for (const scopeId of scopeIds) {
    const cancellation = await cancelTaskScope(scopeId);
    if (!cancellation) {
      continue;
    }

    await markTaskRunDispatchesCancelled(cancellation.openRunsToRemove.map((openRun) => openRun.run_id));
    await Promise.all(
      cancellation.openRunsToRemove.map((openRun) => removePendingRunJob(openRun.task_id, openRun.run_id))
    );
    await emitTaskCancellationEvents(cancellation, input.cancellationMessage);

    cancelledScopeCount += 1;
    runningTaskCount += cancellation.runningTaskIds.length;
    cancelledTaskCount += cancellation.cancelledTaskIds.length;
  }

  const cleared = await waitForNoActiveTasksForWorkspaces({
    workspaceIds,
    timeoutMs: input.timeoutMs
  });
  const remainingActiveTaskCount = cleared ? 0 : await countActiveTasksForWorkspaces(workspaceIds);
  const waitTimedOut = remainingActiveTaskCount > 0;

  if (waitTimedOut && (input.timeoutBehavior ?? "error") !== "continue") {
    throw new Error("Timed out waiting for cancelled tasks to stop.");
  }

  return {
    cancelledScopeCount,
    runningTaskCount,
    cancelledTaskCount,
    waitTimedOut,
    remainingActiveTaskCount
  };
}
