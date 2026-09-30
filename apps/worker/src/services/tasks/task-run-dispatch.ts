import type { PoolClient } from "pg";
import {
  buildDefaultTaskSchedulerSettings,
  buildTaskRunQueueJobId,
  normalizeTaskSchedulerSettings,
  resolveBullMqPriorityForDispatchClass,
  resolveEffectiveTaskRunDispatchClass,
  resolveTaskRunDispatchClass,
  type TaskExecutionJob,
  type TaskRunDispatchCategory,
  type TaskRunDispatchClass,
  type TaskRunDispatchQueueState,
  type TaskSchedulerSettings
} from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { pool, query } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { createTaskDebugLogger } from "../runtime/debug-task-events.js";

const TASK_RUN_DISPATCH_WAKE_CHANNEL = "task_run_dispatch_ready";
const TASK_RUN_DISPATCH_SAFETY_POLL_MS = 30_000;
const TASK_RUN_DISPATCH_LISTEN_RETRY_MS = 30_000;
const TASK_RUN_DISPATCH_LEADER_LOCK = 621_550_001;
const TASK_RUN_DISPATCH_CANDIDATES_PER_WORKSPACE = 25;

export interface TaskRunDispatchRow {
  run_id: string;
  task_id: string;
  workspace_id: string;
  environment_id: string;
  dispatch_class: TaskRunDispatchClass;
  queue_state: TaskRunDispatchQueueState;
  payload_json: TaskExecutionJob;
  eligible_at: string;
  priority_actor_user_id: string | null;
  priority_actor_is_super_admin: boolean;
  queued_at: string;
  admitted_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface PendingDispatchCandidateRow {
  run_id: string;
  task_id: string;
  workspace_id: string;
  environment_id: string;
  dispatch_class: TaskRunDispatchClass;
  payload_json: TaskExecutionJob;
  queued_at: string;
  effective_rank: number;
  workspace_rank: number;
}

interface WorkspaceDispatchCountRow {
  workspace_id: string;
  in_use_count: number;
  admitted_count: number;
}

interface EnvironmentDispatchCountRow {
  environment_id: string;
  in_use_count: number;
}

interface SelectedWorkspaceCandidate {
  runId: string;
  workspaceId: string;
  environmentId: string;
  payload: TaskExecutionJob;
  queuedAt: string;
  effectiveDispatchClass: TaskRunDispatchClass;
  effectiveRank: number;
}

export interface InsertTaskRunDispatchInput {
  runId: string;
  taskId: string;
  workspaceId: string;
  environmentId: string;
  payload: TaskExecutionJob;
  dispatchCategory?: TaskRunDispatchCategory;
  dispatchClass?: TaskRunDispatchClass;
  priorityActorUserId?: string | null;
  priorityActorIsSuperAdmin?: boolean;
  eligibleAt?: string | Date | null;
}

function buildTaskSchedulerDefaults(): TaskSchedulerSettings {
  return buildDefaultTaskSchedulerSettings({
    defaultEnvironmentConcurrency: config.limits.defaultTaskConcurrencyPerEnv,
    maxWorkspaceConcurrency: config.limits.maxConcurrentTasksWorkspace
  });
}

function normalizeEligibleAt(value: string | Date | null | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  return value instanceof Date ? value.toISOString() : value;
}

async function loadPriorityActorIsSuperAdmin(
  client: PoolClient,
  userId: string | null | undefined
): Promise<boolean> {
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

function taskRunDispatchSelectSql(): string {
  return `SELECT run_id,
                 task_id,
                 workspace_id,
                 environment_id,
                 dispatch_class,
                 queue_state,
                 payload_json,
                 eligible_at::text,
                 priority_actor_user_id,
                 priority_actor_is_super_admin,
                 queued_at::text,
                 admitted_at::text,
                 started_at::text,
                 finished_at::text
            FROM task_run_dispatches`;
}

export async function insertTaskRunDispatchWithClient(
  client: PoolClient,
  input: InsertTaskRunDispatchInput
): Promise<{ dispatchClass: TaskRunDispatchClass; priorityActorIsSuperAdmin: boolean }> {
  const priorityActorIsSuperAdmin = input.priorityActorIsSuperAdmin
    ?? await loadPriorityActorIsSuperAdmin(client, input.priorityActorUserId);
  const dispatchClass = input.dispatchClass ?? resolveTaskRunDispatchClass({
    category: input.dispatchCategory ?? "new",
    priorityActorIsSuperAdmin
  });

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
      input.runId,
      input.taskId,
      input.workspaceId,
      input.environmentId,
      dispatchClass,
      JSON.stringify(input.payload),
      normalizeEligibleAt(input.eligibleAt),
      input.priorityActorUserId ?? null,
      priorityActorIsSuperAdmin
    ]
  );

  return {
    dispatchClass,
    priorityActorIsSuperAdmin
  };
}

export async function getTaskRunDispatchWithClient(client: PoolClient, runId: string): Promise<TaskRunDispatchRow | null> {
  const result = await client.query<TaskRunDispatchRow>(
    `${taskRunDispatchSelectSql()}
      WHERE run_id = $1`,
    [runId]
  );

  return result.rows[0] ?? null;
}

export async function getTaskRunDispatch(runId: string): Promise<TaskRunDispatchRow | null> {
  const result = await query<TaskRunDispatchRow>(
    `${taskRunDispatchSelectSql()}
      WHERE run_id = $1`,
    [runId]
  );

  return result.rows[0] ?? null;
}

export async function markTaskRunDispatchPending(runId: string): Promise<void> {
  await query(
    `UPDATE task_run_dispatches
        SET queue_state = 'pending',
            admitted_at = NULL,
            started_at = NULL,
            finished_at = NULL,
            updated_at = now()
      WHERE run_id = $1
        AND queue_state <> 'cancelled'`,
    [runId]
  );
}

export async function markTaskRunDispatchRunning(runId: string): Promise<void> {
  await query(
    `UPDATE task_run_dispatches
        SET queue_state = 'running',
            started_at = COALESCE(started_at, now()),
            updated_at = now()
      WHERE run_id = $1
        AND queue_state IN ('admitted', 'pending')`,
    [runId]
  );
}

export async function markTaskRunDispatchFinished(
  runId: string,
  queueState: Extract<TaskRunDispatchQueueState, "finished" | "cancelled"> = "finished"
): Promise<void> {
  await query(
    `UPDATE task_run_dispatches
        SET queue_state = $2,
            finished_at = now(),
            updated_at = now()
      WHERE run_id = $1`,
    [runId, queueState]
  );
}

export async function markTaskRunDispatchesCancelled(runIds: string[]): Promise<void> {
  const normalizedRunIds = Array.from(new Set(runIds));
  if (normalizedRunIds.length === 0) {
    return;
  }

  await query(
    `UPDATE task_run_dispatches
        SET queue_state = 'cancelled',
            finished_at = now(),
            updated_at = now()
      WHERE run_id = ANY($1::uuid[])
        AND queue_state <> 'cancelled'`,
    [normalizedRunIds]
  );
}

export async function loadTaskSchedulerSettings(): Promise<TaskSchedulerSettings> {
  const defaults = buildTaskSchedulerDefaults();
  const result = await query<{ task_scheduler_json: unknown }>(
    `SELECT task_scheduler_json
       FROM platform_settings
      WHERE id = 1`
  );

  return normalizeTaskSchedulerSettings(result.rows[0]?.task_scheduler_json ?? null, defaults);
}

async function hasEligiblePendingDispatch(): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM task_run_dispatches d
         JOIN task_runs tr
           ON tr.id = d.run_id
          AND tr.ended_at IS NULL
         JOIN tasks t
           ON t.id = d.task_id
        WHERE d.queue_state = 'pending'
          AND d.eligible_at <= now()
          AND t.status = 'queued'
          AND t.trashed_at IS NULL
        LIMIT 1
     ) AS exists`
  );

  return result.rows[0]?.exists === true;
}

async function listPendingDispatchCandidates(settings: TaskSchedulerSettings): Promise<PendingDispatchCandidateRow[]> {
  const result = await query<PendingDispatchCandidateRow>(
    `WITH ranked_pending AS (
        SELECT d.run_id,
               d.task_id,
               d.workspace_id,
               d.environment_id,
               d.dispatch_class,
               d.payload_json,
               d.queued_at::text,
               CASE
                 WHEN d.dispatch_class = 'admin_interactive' THEN 1
                 WHEN d.dispatch_class = 'interactive_followup' THEN 2
                 WHEN d.dispatch_class = 'interactive_new' THEN 3
                 WHEN d.dispatch_class = 'background'
                   AND d.queued_at <= now() - ($1::int * interval '1 minute') THEN 3
                 ELSE 4
               END AS effective_rank,
               ROW_NUMBER() OVER (
                 PARTITION BY d.workspace_id
                 ORDER BY
                   CASE
                     WHEN d.dispatch_class = 'admin_interactive' THEN 1
                     WHEN d.dispatch_class = 'interactive_followup' THEN 2
                     WHEN d.dispatch_class = 'interactive_new' THEN 3
                     WHEN d.dispatch_class = 'background'
                       AND d.queued_at <= now() - ($1::int * interval '1 minute') THEN 3
                     ELSE 4
                   END ASC,
                   d.queued_at ASC,
                   d.run_id ASC
               ) AS workspace_rank
          FROM task_run_dispatches d
          JOIN task_runs tr
            ON tr.id = d.run_id
           AND tr.ended_at IS NULL
          JOIN tasks t
            ON t.id = d.task_id
         WHERE d.queue_state = 'pending'
           AND d.eligible_at <= now()
           AND t.status = 'queued'
           AND t.trashed_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM task_subagent_sessions s WHERE s.task_id = t.id
             AND (SELECT count(*) FROM task_subagent_sessions sibling
               JOIN task_run_dispatches active ON active.task_id = sibling.task_id
               WHERE sibling.root_task_id = s.root_task_id AND active.queue_state IN ('admitted', 'running')) >= 3
           )
      )
      SELECT run_id,
             task_id,
             workspace_id,
             environment_id,
             dispatch_class,
             payload_json,
             queued_at,
             effective_rank,
             workspace_rank
        FROM ranked_pending
       WHERE workspace_rank <= $2
       ORDER BY workspace_id ASC, workspace_rank ASC`,
    [settings.backgroundAgingMinutes, TASK_RUN_DISPATCH_CANDIDATES_PER_WORKSPACE]
  );

  return result.rows;
}

async function listWorkspaceDispatchCounts(): Promise<Map<string, { inUseCount: number; admittedCount: number }>> {
  const result = await query<WorkspaceDispatchCountRow>(
    `SELECT d.workspace_id,
            COUNT(*) FILTER (
              WHERE d.queue_state IN ('admitted', 'running')
                AND t.status IN ('queued', 'starting', 'running')
            )::int AS in_use_count,
            COUNT(*) FILTER (
              WHERE d.queue_state = 'admitted'
                AND t.status = 'queued'
            )::int AS admitted_count
       FROM task_run_dispatches d
       JOIN task_runs tr
         ON tr.id = d.run_id
        AND tr.ended_at IS NULL
       JOIN tasks t
         ON t.id = d.task_id
        AND t.trashed_at IS NULL
      WHERE d.queue_state IN ('admitted', 'running')
      GROUP BY d.workspace_id`
  );

  return new Map(result.rows.map((row) => [
    row.workspace_id,
    {
      inUseCount: Number(row.in_use_count ?? 0),
      admittedCount: Number(row.admitted_count ?? 0)
    }
  ]));
}

async function listEnvironmentDispatchCounts(): Promise<Map<string, number>> {
  const result = await query<EnvironmentDispatchCountRow>(
    `SELECT d.environment_id,
            COUNT(*) FILTER (
              WHERE d.queue_state IN ('admitted', 'running')
                AND t.status IN ('queued', 'starting', 'running')
            )::int AS in_use_count
       FROM task_run_dispatches d
       JOIN task_runs tr
         ON tr.id = d.run_id
        AND tr.ended_at IS NULL
       JOIN tasks t
         ON t.id = d.task_id
        AND t.trashed_at IS NULL
      WHERE d.queue_state IN ('admitted', 'running')
      GROUP BY d.environment_id`
  );

  return new Map(result.rows.map((row) => [row.environment_id, Number(row.in_use_count ?? 0)]));
}

function compareWorkspaceSelections(
  a: SelectedWorkspaceCandidate,
  b: SelectedWorkspaceCandidate,
  workspaceCounts: Map<string, { inUseCount: number; admittedCount: number }>
): number {
  const aInUse = workspaceCounts.get(a.workspaceId)?.inUseCount ?? 0;
  const bInUse = workspaceCounts.get(b.workspaceId)?.inUseCount ?? 0;
  if (aInUse !== bInUse) {
    return aInUse - bInUse;
  }

  if (a.effectiveRank !== b.effectiveRank) {
    return a.effectiveRank - b.effectiveRank;
  }

  const queuedCompare = a.queuedAt.localeCompare(b.queuedAt);
  if (queuedCompare !== 0) {
    return queuedCompare;
  }

  const workspaceCompare = a.workspaceId.localeCompare(b.workspaceId);
  if (workspaceCompare !== 0) {
    return workspaceCompare;
  }

  return a.runId.localeCompare(b.runId);
}

function selectWorkspaceCandidate(input: {
  candidates: PendingDispatchCandidateRow[];
  workspaceCounts: Map<string, { inUseCount: number; admittedCount: number }>;
  environmentCounts: Map<string, number>;
  settings: TaskSchedulerSettings;
}): SelectedWorkspaceCandidate | null {
  const candidateGroups = new Map<string, PendingDispatchCandidateRow[]>();
  for (const candidate of input.candidates) {
    const group = candidateGroups.get(candidate.workspace_id) ?? [];
    group.push(candidate);
    candidateGroups.set(candidate.workspace_id, group);
  }

  const selectedCandidates: SelectedWorkspaceCandidate[] = [];
  for (const [workspaceId, candidates] of candidateGroups.entries()) {
    const workspaceCount = input.workspaceCounts.get(workspaceId) ?? { inUseCount: 0, admittedCount: 0 };
    if (workspaceCount.inUseCount >= input.settings.maxWorkspaceConcurrency) {
      continue;
    }
    if (workspaceCount.admittedCount >= input.settings.maxQueuedAheadPerWorkspace) {
      continue;
    }

    const chosen = candidates.find((candidate) => {
      const environmentInUse = input.environmentCounts.get(candidate.environment_id) ?? 0;
      return environmentInUse < input.settings.defaultEnvironmentConcurrency;
    });
    if (!chosen) {
      continue;
    }

    selectedCandidates.push({
      runId: chosen.run_id,
      workspaceId,
      environmentId: chosen.environment_id,
      payload: chosen.payload_json,
      queuedAt: chosen.queued_at,
      effectiveDispatchClass: resolveEffectiveTaskRunDispatchClass({
        dispatchClass: chosen.dispatch_class,
        queuedAt: chosen.queued_at,
        backgroundAgingMinutes: input.settings.backgroundAgingMinutes
      }),
      effectiveRank: chosen.effective_rank
    });
  }

  if (selectedCandidates.length === 0) {
    return null;
  }

  selectedCandidates.sort((a, b) => compareWorkspaceSelections(a, b, input.workspaceCounts));
  return selectedCandidates[0] ?? null;
}

async function claimDispatchForAdmission(runId: string): Promise<TaskRunDispatchRow | null> {
  const result = await query<TaskRunDispatchRow>(
    `UPDATE task_run_dispatches
        SET queue_state = 'admitted',
            admitted_at = now(),
            updated_at = now()
      WHERE run_id = $1
        AND queue_state = 'pending'
        AND EXISTS (
          SELECT 1
            FROM task_runs tr
            JOIN tasks t
              ON t.id = task_run_dispatches.task_id
           WHERE tr.id = task_run_dispatches.run_id
             AND tr.ended_at IS NULL
             AND t.status = 'queued'
             AND t.trashed_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM task_subagent_sessions s WHERE s.task_id = t.id
             AND (SELECT count(*) FROM task_subagent_sessions sibling
               JOIN task_run_dispatches active ON active.task_id = sibling.task_id
               WHERE sibling.root_task_id = s.root_task_id AND active.queue_state IN ('admitted', 'running')) >= 3
           )
        )
      RETURNING run_id,
                task_id,
                workspace_id,
                environment_id,
                dispatch_class,
                queue_state,
                payload_json,
                eligible_at::text,
                priority_actor_user_id,
                priority_actor_is_super_admin,
                queued_at::text,
                admitted_at::text,
                started_at::text,
                finished_at::text`,
    [runId]
  );

  return result.rows[0] ?? null;
}

function isDuplicateJobError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const lowerMessage = error.message.toLowerCase();
  return lowerMessage.includes("jobid") && lowerMessage.includes("exist");
}

async function enqueueClaimedDispatch(input: {
  row: TaskRunDispatchRow;
  effectiveDispatchClass: TaskRunDispatchClass;
}): Promise<void> {
  const payload = input.row.payload_json;
  const jobId = buildTaskRunQueueJobId(payload.taskId, payload.runId);

  try {
    await taskQueue.add(jobId, payload, {
      jobId,
      attempts: 1,
      removeOnComplete: 200,
      removeOnFail: 200,
      priority: resolveBullMqPriorityForDispatchClass(input.effectiveDispatchClass)
    });
  } catch (error) {
    if (isDuplicateJobError(error)) {
      return;
    }

    await markTaskRunDispatchPending(input.row.run_id);
    throw error;
  }
}

export async function runTaskRunDispatchOnce(): Promise<number> {
  if (!await hasEligiblePendingDispatch()) {
    return 0;
  }

  const settings = await loadTaskSchedulerSettings();
  const [pendingCandidates, workspaceCounts, environmentCounts] = await Promise.all([
    listPendingDispatchCandidates(settings),
    listWorkspaceDispatchCounts(),
    listEnvironmentDispatchCounts()
  ]);

  const mutableCandidates = [...pendingCandidates];
  let admittedCount = 0;

  while (mutableCandidates.length > 0) {
    const selected = selectWorkspaceCandidate({
      candidates: mutableCandidates,
      workspaceCounts,
      environmentCounts,
      settings
    });
    if (!selected) {
      break;
    }

    const claimed = await claimDispatchForAdmission(selected.runId);
    const selectedIndex = mutableCandidates.findIndex((candidate) => candidate.run_id === selected.runId);
    if (selectedIndex >= 0) {
      mutableCandidates.splice(selectedIndex, 1);
    }
    if (!claimed) {
      continue;
    }

    await enqueueClaimedDispatch({
      row: claimed,
      effectiveDispatchClass: selected.effectiveDispatchClass
    });
    await createTaskDebugLogger(claimed.task_id).log("Run admitted to worker queue.", {
      stage: "dispatch.admitted",
      phase: "success",
      runId: claimed.run_id,
      workspaceId: claimed.workspace_id,
      environmentId: claimed.environment_id,
      dispatchClass: claimed.dispatch_class,
      effectiveDispatchClass: selected.effectiveDispatchClass,
      queueState: claimed.queue_state
    });

    const nextWorkspaceCounts = workspaceCounts.get(selected.workspaceId) ?? { inUseCount: 0, admittedCount: 0 };
    workspaceCounts.set(selected.workspaceId, {
      inUseCount: nextWorkspaceCounts.inUseCount + 1,
      admittedCount: nextWorkspaceCounts.admittedCount + 1
    });
    environmentCounts.set(selected.environmentId, (environmentCounts.get(selected.environmentId) ?? 0) + 1);
    admittedCount += 1;
  }

  return admittedCount;
}

async function withDispatchLeaderLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [TASK_RUN_DISPATCH_LEADER_LOCK]
    );
    if (lockResult.rows[0]?.acquired !== true) {
      return null;
    }

    try {
      return await fn();
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [TASK_RUN_DISPATCH_LEADER_LOCK]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

export function startTaskRunDispatchLoop(): { stop: () => Promise<void> } {
  let stopping = false;
  let running = false;
  let rerunRequested = false;
  let timer: NodeJS.Timeout | null = null;
  let listenRetryTimer: NodeJS.Timeout | null = null;
  let listenerClient: PoolClient | null = null;
  let pendingRun: Promise<void> | null = null;

  const scheduleRun = (delayMs: number): void => {
    if (stopping) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void runOnce();
    }, Math.max(0, delayMs));
    timer.unref();
  };

  const requestRun = (): void => {
    if (stopping) {
      return;
    }
    if (running) {
      rerunRequested = true;
      return;
    }
    scheduleRun(0);
  };

  const scheduleListenRetry = (): void => {
    if (stopping || listenRetryTimer) {
      return;
    }
    listenRetryTimer = setTimeout(() => {
      listenRetryTimer = null;
      void startListener();
    }, TASK_RUN_DISPATCH_LISTEN_RETRY_MS);
    listenRetryTimer.unref();
  };

  const startListener = async (): Promise<void> => {
    if (stopping || listenerClient) {
      return;
    }

    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      if (stopping) {
        client.release();
        return;
      }

      const releaseClient = (): void => {
        if (!client) {
          return;
        }
        client.removeAllListeners("notification");
        client.removeAllListeners("error");
        if (listenerClient === client) {
          listenerClient = null;
        }
        client.release();
        client = null;
      };

      client.on("notification", requestRun);
      client.on("error", (error) => {
        console.error("Task dispatcher notification listener failed", error);
        releaseClient();
        scheduleListenRetry();
      });
      await client.query(`LISTEN ${TASK_RUN_DISPATCH_WAKE_CHANNEL}`);
      listenerClient = client;
    } catch (error) {
      console.error("Task dispatcher failed to start notification listener", error);
      if (client) {
        client.removeAllListeners("notification");
        client.removeAllListeners("error");
        client.release();
      }
      scheduleListenRetry();
    }
  };

  async function runOnce(): Promise<void> {
    if (stopping || running) {
      return;
    }

    running = true;
    pendingRun = (async () => {
      await withDispatchLeaderLock(async () => {
        const admittedCount = await runTaskRunDispatchOnce();
        if (admittedCount > 0) {
          console.log(`Task dispatcher admitted ${admittedCount} run(s)`);
        }
      });
    })()
      .catch((error) => {
        console.error("Task dispatcher loop failed", error);
      })
      .finally(() => {
        running = false;
        pendingRun = null;
        if (rerunRequested) {
          rerunRequested = false;
          scheduleRun(0);
          return;
        }
        scheduleRun(TASK_RUN_DISPATCH_SAFETY_POLL_MS);
      });

    await pendingRun;
  }

  void startListener();
  scheduleRun(0);

  return {
    stop: async (): Promise<void> => {
      stopping = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (listenRetryTimer) {
        clearTimeout(listenRetryTimer);
        listenRetryTimer = null;
      }
      if (pendingRun) {
        await pendingRun;
      }
      if (listenerClient) {
        const client = listenerClient;
        listenerClient = null;
        client.removeAllListeners("notification");
        client.removeAllListeners("error");
        await client.query(`UNLISTEN ${TASK_RUN_DISPATCH_WAKE_CHANNEL}`).catch(() => undefined);
        client.release();
      }
    }
  };
}
