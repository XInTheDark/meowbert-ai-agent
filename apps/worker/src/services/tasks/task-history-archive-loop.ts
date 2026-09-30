import { getTaskHistoryArchiveHealth } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { query, withConnection, withTransaction } from "../../lib/db.js";
import { archiveTaskHistory, resetStaleTaskHistoryArchiving } from "./task-history.js";
import {
  attachTaskToArchiveRun,
  completeArchiveRun,
  createScheduledArchiveRun,
  failArchiveRun,
  skipArchiveRun,
  type TaskHistoryArchiveTriggerSource
} from "./task-history-archive-activity.js";

const TASK_HISTORY_ARCHIVE_LOOP_INTERVAL_MS = 5 * 60_000;
const TASK_HISTORY_ARCHIVE_BACKLOG_INTERVAL_MS = 5_000;
const TASK_HISTORY_ARCHIVE_MAX_TASKS_PER_PASS = 1;
const TASK_HISTORY_ARCHIVE_MAX_FAILED_ATTEMPTS = 3;
const TASK_HISTORY_ARCHIVE_LOCK_NAMESPACE = 1_296_382;
const TASK_HISTORY_ARCHIVE_LOCK_ID = 2;

interface ArchiveRetentionRow {
  task_history_warm_retention_days: number;
}

interface ArchiveCandidateRow {
  id: string;
}

interface TaskHistoryArchivePassInput {
  activityRunId?: string;
  triggerSource?: TaskHistoryArchiveTriggerSource;
}

async function loadTaskHistoryWarmRetentionDays(): Promise<number> {
  const result = await query<ArchiveRetentionRow>(
    `SELECT task_history_warm_retention_days
       FROM platform_settings
      WHERE id = 1`
  );

  return Number(result.rows[0]?.task_history_warm_retention_days ?? 0) || 0;
}

async function claimNextArchiveCandidate(cutoffIso: string): Promise<string | null> {
  return withTransaction(async (client) => {
    const result = await client.query<ArchiveCandidateRow>(
      `SELECT t.id
         FROM tasks t
         LEFT JOIN task_schedules ts ON ts.task_id = t.id
        WHERE t.task_history_state = 'warm'
          AND t.task_history_archive_failed_attempts < $2
          AND t.status NOT IN ('queued', 'starting', 'running')
          AND COALESCE(ts.schedule_state, 'cancelled') <> 'active'
          AND GREATEST(
            t.task_history_last_active_at,
            COALESCE(t.task_history_last_warmed_at, to_timestamp(0))
          ) < $1::timestamptz
        ORDER BY GREATEST(
            t.task_history_last_active_at,
            COALESCE(t.task_history_last_warmed_at, to_timestamp(0))
          ) ASC,
          t.task_history_last_active_at ASC,
          t.id ASC
        LIMIT 1
        FOR UPDATE OF t SKIP LOCKED`,
      [cutoffIso, TASK_HISTORY_ARCHIVE_MAX_FAILED_ATTEMPTS]
    );

    return result.rows[0]?.id ?? null;
  });
}

async function runLockedTaskHistoryArchivePass(
  input: TaskHistoryArchivePassInput = {}
): Promise<number> {
  const triggerSource = input.triggerSource ?? "scheduled";
  const retentionDays = await loadTaskHistoryWarmRetentionDays();
  if (retentionDays <= 0) {
    if (input.activityRunId) {
      await skipArchiveRun(input.activityRunId, "Warm retention is disabled.");
    }
    return 0;
  }

  const health = await getTaskHistoryArchiveHealth(config.taskHistoryArchive);
  if (health.state !== "ready") {
    console.warn(
      `[task-history] Archive storage unavailable; skipping archive pass: ${health.message ?? "unknown archive storage error"}`
    );
    if (input.activityRunId) {
      await failArchiveRun(
        input.activityRunId,
        health.message ?? "Archive storage is unavailable."
      );
    }
    return 0;
  }

  const resetCount = await resetStaleTaskHistoryArchiving();
  if (resetCount > 0) {
    console.warn(`[task-history] Reset ${resetCount} stale archiving task(s)`);
  }

  const cutoffIso = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const candidateTaskId = await claimNextArchiveCandidate(cutoffIso);
  if (!candidateTaskId) {
    if (input.activityRunId) {
      await skipArchiveRun(input.activityRunId, "No task is currently eligible for cold storage.");
    }
    return 0;
  }

  const activityRunId = input.activityRunId
    ?? await createScheduledArchiveRun(candidateTaskId);
  if (input.activityRunId) {
    await attachTaskToArchiveRun(activityRunId, candidateTaskId);
  }

  try {
    const result = await archiveTaskHistory(candidateTaskId);
    await completeArchiveRun(activityRunId, result);
    if (result.status === "archived") {
      console.log(`[task-history] Archived task ${candidateTaskId} (${triggerSource})`);
      return 1;
    }
    return 0;
  } catch (error) {
    await failArchiveRun(activityRunId, error).catch(() => undefined);
    throw error;
  }
}

export async function runTaskHistoryArchivePass(
  input: TaskHistoryArchivePassInput = {}
): Promise<number> {
  return withConnection(async (client) => {
    await client.query(
      "SELECT pg_advisory_lock($1::int, $2::int)",
      [TASK_HISTORY_ARCHIVE_LOCK_NAMESPACE, TASK_HISTORY_ARCHIVE_LOCK_ID]
    );
    try {
      return await runLockedTaskHistoryArchivePass(input);
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock($1::int, $2::int)",
        [TASK_HISTORY_ARCHIVE_LOCK_NAMESPACE, TASK_HISTORY_ARCHIVE_LOCK_ID]
      ).catch(() => undefined);
    }
  });
}

export function startTaskHistoryArchiveLoop(): { stop: () => Promise<void> } {
  let stopping = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;
  let pendingRun: Promise<void> | null = null;

  const scheduleNext = (delayMs: number): void => {
    if (stopping) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void runOnce();
    }, delayMs);
  };

  const runOnce = async (): Promise<void> => {
    if (stopping || running) {
      return;
    }

    running = true;
    let nextDelayMs = TASK_HISTORY_ARCHIVE_LOOP_INTERVAL_MS;
    pendingRun = runTaskHistoryArchivePass()
      .then((archivedCount) => {
        if (archivedCount >= TASK_HISTORY_ARCHIVE_MAX_TASKS_PER_PASS) {
          nextDelayMs = TASK_HISTORY_ARCHIVE_BACKLOG_INTERVAL_MS;
          console.log(
            `[task-history] Archived ${TASK_HISTORY_ARCHIVE_MAX_TASKS_PER_PASS} task(s); continuing backlog shortly`
          );
        }
      })
      .catch((error) => {
        console.error("[task-history] Archive loop failed", error);
      })
      .finally(() => {
        running = false;
        pendingRun = null;
        scheduleNext(nextDelayMs);
      });

    await pendingRun;
  };

  void runOnce();

  return {
    stop: async (): Promise<void> => {
      stopping = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (pendingRun) {
        await pendingRun;
      }
    }
  };
}
