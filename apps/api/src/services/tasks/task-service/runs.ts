import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  buildTaskRunQueueJobId,
  resolveTaskRunDispatchClass,
  touchTaskHistoryActivity,
  type TaskExecutionJob,
  type TaskRunDispatchCategory,
  type TaskRunDispatchClass,
  type TaskSource,
  type TaskStatus
} from "@meowbert/shared";
import { taskQueue } from "../../../lib/queue.js";
import { withTransaction } from "../../../lib/db.js";

export interface EnqueueRunInput {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  triggerSource: TaskSource;
  mode?:
    | "default"
    | "compact_only"
    | "scheduled_auto"
    | "infinite_auto"
    | "infinite_checkin"
    | "long_horizon_clarify"
    | "long_horizon_main"
    | "long_horizon_reviewer"
    | "quality_control_reviewer"
    | "agent_swarm_leader"
    | "agent_swarm_worker"
    | "memory_synthesis";
  restoreStatus?: TaskStatus;
  branchMessageId?: string;
  selectionUserId?: string;
  priorityActorUserId?: string;
  toolOptionsOverride?: {
    webSearch?: boolean;
    memorySearch?: boolean;
    scheduleTask?: boolean;
    subtasks?: boolean;
    computerUse?: boolean;
    enabledSkills?: string[];
    enabledSources?: string[];
  };
  quickMode?: boolean;
  contextAction?: "compact" | "clear";
  dispatchCategory?: TaskRunDispatchCategory;
  dispatchClass?: TaskRunDispatchClass;
  delayMs?: number;
}

export interface EnsureDispatchedRunInput extends EnqueueRunInput {
  dispatchCategory: TaskRunDispatchCategory;
}

interface LatestTaskRunRow {
  id: string;
  attempt_no: number;
}

async function loadPriorityActorIsSuperAdmin(client: Pick<PoolClient, "query">, userId: string | undefined): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const actorRes = await client.query<{ is_super_admin: boolean }>(
    `SELECT is_super_admin
       FROM users
      WHERE id = $1`,
    [userId]
  );

  return actorRes.rows[0]?.is_super_admin === true;
}

function buildTaskExecutionPayload(input: EnqueueRunInput, runId: string, runMode: NonNullable<EnqueueRunInput["mode"]> | "default"): TaskExecutionJob {
  return {
    taskId: input.taskId,
    runId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    triggerSource: input.triggerSource,
    mode: runMode,
    restoreStatus: input.restoreStatus,
    branchMessageId: input.branchMessageId,
    selectionUserId: input.selectionUserId,
    toolOptionsOverride: input.toolOptionsOverride,
    quickMode: input.quickMode === true,
    ...(input.contextAction ? { contextAction: input.contextAction } : {})
  };
}

async function lockTaskRow(client: PoolClient, taskId: string): Promise<void> {
  const taskLockRes = await client.query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE id = $1
      FOR UPDATE`,
    [taskId]
  );
  if ((taskLockRes.rowCount ?? 0) === 0) {
    throw new Error(`Task not found: ${taskId}`);
  }
}

async function loadLatestTaskRun(client: PoolClient, taskId: string): Promise<LatestTaskRunRow | null> {
  const latestRunRes = await client.query<LatestTaskRunRow>(
    `SELECT id, attempt_no
       FROM task_runs
      WHERE task_id = $1
      ORDER BY attempt_no DESC, id DESC
      LIMIT 1`,
    [taskId]
  );

  return latestRunRes.rows[0] ?? null;
}

async function createRunRecord(
  client: PoolClient,
  input: EnqueueRunInput,
  runId: string,
  runMode: NonNullable<EnqueueRunInput["mode"]> | "default",
  payload: TaskExecutionJob
): Promise<number> {
  const attemptResult = await client.query<{ attempt_no: number }>(
    `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
     FROM task_runs
     WHERE task_id = $1`,
    [input.taskId]
  );
  const nextAttemptNo = attemptResult.rows[0].attempt_no;

  await client.query(
    `INSERT INTO task_runs (id, task_id, attempt_no, run_kind)
     VALUES ($1, $2, $3, $4)`,
    [runId, input.taskId, nextAttemptNo, runMode]
  );

  await client.query(
    `UPDATE tasks
        SET status = 'queued',
            cancellation_requested = false,
            resume_after_interrupt = false,
            completed_at = NULL,
            trashed_at = CASE WHEN $2 = 'compact_only' THEN trashed_at ELSE NULL END,
            updated_at = now()
      WHERE id = $1`,
    [input.taskId, runMode]
  );
  await touchTaskHistoryActivity(client, input.taskId, new Date().toISOString());

  const explicitDispatchClass = input.dispatchClass;
  const shouldCreateDispatch = explicitDispatchClass !== undefined || input.dispatchCategory !== undefined;
  if (shouldCreateDispatch) {
    const priorityActorIsSuperAdmin = explicitDispatchClass === "admin_interactive"
      ? true
      : await loadPriorityActorIsSuperAdmin(client, input.priorityActorUserId);
    const dispatchClass = explicitDispatchClass ?? resolveTaskRunDispatchClass({
      category: input.dispatchCategory ?? "new",
      priorityActorIsSuperAdmin
    });
    const eligibleAt = typeof input.delayMs === "number" && input.delayMs > 0
      ? new Date(Date.now() + input.delayMs).toISOString()
      : new Date().toISOString();

    await client.query(
      `INSERT INTO task_run_dispatches (
        run_id,
        task_id,
        workspace_id,
        environment_id,
        dispatch_class,
        queue_state,
        payload_json,
        eligible_at,
        priority_actor_user_id,
        priority_actor_is_super_admin
      )
      VALUES ($1, $2, $3, $4, $5, 'pending', $6::jsonb, $7, $8, $9)`,
      [
        runId,
        input.taskId,
        input.workspaceId,
        input.environmentId,
        dispatchClass,
        JSON.stringify(payload),
        eligibleAt,
        input.priorityActorUserId ?? null,
        priorityActorIsSuperAdmin
      ]
    );
  }

  return nextAttemptNo;
}

export async function enqueueRun(input: EnqueueRunInput): Promise<{ runId: string; attemptNo: number }> {
  const runId = randomUUID();
  const jobId = buildTaskRunQueueJobId(input.taskId, runId);
  const runMode = input.mode ?? "default";
  const payload = buildTaskExecutionPayload(input, runId, runMode);
  const attemptNo = await withTransaction(async (client) => {
    await lockTaskRow(client, input.taskId);
    return createRunRecord(client, input, runId, runMode, payload);
  });

  if (input.dispatchClass !== undefined || input.dispatchCategory !== undefined) {
    return { runId, attemptNo };
  }

  await taskQueue.add(jobId, payload, {
    jobId,
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 200,
    ...(typeof input.delayMs === "number" && input.delayMs > 0 ? { delay: input.delayMs } : {})
  });

  return { runId, attemptNo };
}

export async function ensureDispatchedRun(
  input: EnsureDispatchedRunInput
): Promise<{ runId: string; attemptNo: number; reusedExisting: boolean }> {
  const runId = randomUUID();
  const runMode = input.mode ?? "default";
  const payload = buildTaskExecutionPayload(input, runId, runMode);

  return withTransaction(async (client) => {
    await lockTaskRow(client, input.taskId);
    const latestRun = await loadLatestTaskRun(client, input.taskId);
    if (latestRun) {
      return {
        runId: latestRun.id,
        attemptNo: latestRun.attempt_no,
        reusedExisting: true
      };
    }

    const attemptNo = await createRunRecord(client, input, runId, runMode, payload);
    return {
      runId,
      attemptNo,
      reusedExisting: false
    };
  });
}
