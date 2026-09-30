import { query, withTransaction } from "../../lib/db.js";
import {
  RECURRING_SCHEDULER_BATCH_SIZE,
  RECURRING_SCHEDULER_INTERVAL_MS,
  type PreparedRun,
  type RecurringScheduleRow,
  assertFiveFieldCron,
  computeNextCronRunAt,
  normalizeEnabledTools,
  normalizeTaskSource,
  prepareRunWithClient,
  queuePreparedRun,
  recurringRunMode,
  validateCronCadence
} from "./shared.js";
import {
  recordRecurringRunPromptUsageInTx,
  resolveRecurringRunPromptEntitlementInTx
} from "./recurring-run-entitlement.js";

async function processScheduledDueTask(taskId: string): Promise<PreparedRun | null> {
  return withTransaction(async (client) => {
    const rowRes = await client.query<RecurringScheduleRow>(
      `SELECT
          ts.task_id,
          t.workspace_id,
          t.environment_id,
          t.source,
          ts.mode,
          ts.schedule_state,
          ts.repeat_cron,
          ts.timezone,
          ts.next_run_at,
          ts.pending_run,
          ts.enabled_tools_json,
          ts.run_timeout_seconds,
          ts.run_deadline_at
         FROM task_schedules ts
         JOIN tasks t ON t.id = ts.task_id
        WHERE ts.task_id = $1
        FOR UPDATE`,
      [taskId]
    );

    if ((rowRes.rowCount ?? 0) === 0) {
      return null;
    }

    const row = rowRes.rows[0];
    if (row.mode !== "scheduled" || row.schedule_state !== "active") {
      return null;
    }

    const promptEntitlement = await resolveRecurringRunPromptEntitlementInTx(client, taskId);
    if (!promptEntitlement) {
      return null;
    }

    const statusRes = await client.query<{ status: string }>(
      `SELECT status
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [taskId]
    );

    const taskStatus = statusRes.rows[0]?.status;
    if (!taskStatus) {
      return null;
    }

    let nextRunAt: Date;
    try {
      const cron = assertFiveFieldCron(row.repeat_cron ?? "");
      validateCronCadence(cron, row.timezone);
      nextRunAt = computeNextCronRunAt(cron, row.timezone, new Date());
    } catch {
      await client.query(
        `UPDATE task_schedules
            SET schedule_state = 'paused',
                next_run_at = NULL,
                pending_run = false,
                updated_at = now()
          WHERE task_id = $1`,
        [taskId]
      );
      return null;
    }

    if (taskStatus === "running" || taskStatus === "queued") {
      await client.query(
        `UPDATE task_schedules
            SET pending_run = true,
                next_run_at = $2,
                updated_at = now()
          WHERE task_id = $1`,
        [taskId, nextRunAt.toISOString()]
      );
      return null;
    }

    const prepared = await prepareRunWithClient(client, {
      taskId,
      workspaceId: row.workspace_id,
      environmentId: row.environment_id,
      source: normalizeTaskSource(row.source),
      mode: "scheduled_auto",
      dispatchCategory: "background",
      toolOptionsOverride: normalizeEnabledTools(row.enabled_tools_json)
    });
    await recordRecurringRunPromptUsageInTx({
      client,
      taskId,
      accountableUserId: promptEntitlement.accountableUserId,
      entitlement: promptEntitlement.entitlement
    });

    await client.query(
      `UPDATE task_schedules
          SET pending_run = false,
              next_run_at = $2,
              updated_at = now()
        WHERE task_id = $1`,
      [taskId, nextRunAt.toISOString()]
    );

    return prepared;
  });
}

async function processInfiniteDueTask(taskId: string): Promise<PreparedRun | null> {
  return withTransaction(async (client) => {
    const rowRes = await client.query<RecurringScheduleRow>(
      `SELECT
          ts.task_id,
          t.workspace_id,
          t.environment_id,
          t.source,
          ts.mode,
          ts.schedule_state,
          ts.repeat_cron,
          ts.timezone,
          ts.next_run_at,
          ts.pending_run,
          ts.enabled_tools_json,
          ts.run_timeout_seconds,
          ts.run_deadline_at
         FROM task_schedules ts
         JOIN tasks t ON t.id = ts.task_id
        WHERE ts.task_id = $1
        FOR UPDATE`,
      [taskId]
    );

    if ((rowRes.rowCount ?? 0) === 0) {
      return null;
    }

    const row = rowRes.rows[0];
    if (row.mode !== "infinite" || row.schedule_state !== "active") {
      return null;
    }

    const promptEntitlement = await resolveRecurringRunPromptEntitlementInTx(client, taskId);
    if (!promptEntitlement) {
      return null;
    }

    const statusRes = await client.query<{ status: string }>(
      `SELECT status
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [taskId]
    );

    const taskStatus = statusRes.rows[0]?.status;
    if (!taskStatus) {
      return null;
    }

    if (taskStatus === "running" || taskStatus === "queued") {
      await client.query(
        `UPDATE task_schedules
            SET pending_run = true,
                next_run_at = NULL,
                updated_at = now()
          WHERE task_id = $1`,
        [taskId]
      );
      return null;
    }

    const prepared = await prepareRunWithClient(client, {
      taskId,
      workspaceId: row.workspace_id,
      environmentId: row.environment_id,
      source: normalizeTaskSource(row.source),
      mode: "infinite_auto",
      dispatchCategory: "background",
      toolOptionsOverride: normalizeEnabledTools(row.enabled_tools_json)
    });
    await recordRecurringRunPromptUsageInTx({
      client,
      taskId,
      accountableUserId: promptEntitlement.accountableUserId,
      entitlement: promptEntitlement.entitlement
    });

    await client.query(
      `UPDATE task_schedules
          SET pending_run = false,
              next_run_at = NULL,
              updated_at = now()
        WHERE task_id = $1`,
      [taskId]
    );

    return prepared;
  });
}

async function processPendingTask(taskId: string): Promise<PreparedRun | null> {
  return withTransaction(async (client) => {
    const rowRes = await client.query<RecurringScheduleRow>(
      `SELECT
          ts.task_id,
          t.workspace_id,
          t.environment_id,
          t.source,
          ts.mode,
          ts.schedule_state,
          ts.repeat_cron,
          ts.timezone,
          ts.next_run_at,
          ts.pending_run,
          ts.enabled_tools_json,
          ts.run_timeout_seconds,
          ts.run_deadline_at
         FROM task_schedules ts
         JOIN tasks t ON t.id = ts.task_id
        WHERE ts.task_id = $1
        FOR UPDATE`,
      [taskId]
    );

    if ((rowRes.rowCount ?? 0) === 0) {
      return null;
    }

    const row = rowRes.rows[0];
    if (row.schedule_state !== "active" || row.pending_run !== true) {
      return null;
    }

    const promptEntitlement = await resolveRecurringRunPromptEntitlementInTx(client, taskId);
    if (!promptEntitlement) {
      return null;
    }

    const statusRes = await client.query<{ status: string }>(
      `SELECT status
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [taskId]
    );

    const taskStatus = statusRes.rows[0]?.status;
    if (!taskStatus) {
      return null;
    }

    if (taskStatus === "running" || taskStatus === "queued") {
      return null;
    }

    const prepared = await prepareRunWithClient(client, {
      taskId,
      workspaceId: row.workspace_id,
      environmentId: row.environment_id,
      source: normalizeTaskSource(row.source),
      mode: recurringRunMode(row.mode),
      dispatchCategory: "background",
      toolOptionsOverride: normalizeEnabledTools(row.enabled_tools_json)
    });
    await recordRecurringRunPromptUsageInTx({
      client,
      taskId,
      accountableUserId: promptEntitlement.accountableUserId,
      entitlement: promptEntitlement.entitlement
    });

    await client.query(
      `UPDATE task_schedules
          SET pending_run = false,
              updated_at = now()
        WHERE task_id = $1`,
      [taskId]
    );

    return prepared;
  });
}

export async function runRecurringSchedulerOnce(): Promise<number> {
  const [pendingRes, dueScheduledRes, dueInfiniteRes] = await Promise.all([
    query<{ task_id: string }>(
      `SELECT ts.task_id
         FROM task_schedules ts
         JOIN tasks t ON t.id = ts.task_id
        WHERE ts.schedule_state = 'active'
          AND ts.pending_run = true
          AND t.trashed_at IS NULL
        ORDER BY ts.updated_at ASC
        LIMIT $1`,
      [RECURRING_SCHEDULER_BATCH_SIZE]
    ),
    query<{ task_id: string }>(
      `SELECT ts.task_id
         FROM task_schedules ts
         JOIN tasks t ON t.id = ts.task_id
        WHERE ts.schedule_state = 'active'
          AND ts.mode = 'scheduled'
          AND ts.next_run_at IS NOT NULL
          AND ts.next_run_at <= now()
          AND t.trashed_at IS NULL
        ORDER BY ts.next_run_at ASC
        LIMIT $1`,
      [RECURRING_SCHEDULER_BATCH_SIZE]
    ),
    query<{ task_id: string }>(
      `SELECT ts.task_id
         FROM task_schedules ts
         JOIN tasks t ON t.id = ts.task_id
        WHERE ts.schedule_state = 'active'
          AND ts.mode = 'infinite'
          AND ts.next_run_at IS NOT NULL
          AND ts.next_run_at <= now()
          AND t.trashed_at IS NULL
        ORDER BY ts.next_run_at ASC
        LIMIT $1`,
      [RECURRING_SCHEDULER_BATCH_SIZE]
    )
  ]);

  let enqueuedCount = 0;

  for (const row of pendingRes.rows) {
    const prepared = await processPendingTask(row.task_id);
    if (!prepared) {
      continue;
    }
    await queuePreparedRun(prepared);
    enqueuedCount += 1;
  }

  for (const row of dueScheduledRes.rows) {
    const prepared = await processScheduledDueTask(row.task_id);
    if (!prepared) {
      continue;
    }
    await queuePreparedRun(prepared);
    enqueuedCount += 1;
  }

  for (const row of dueInfiniteRes.rows) {
    const prepared = await processInfiniteDueTask(row.task_id);
    if (!prepared) {
      continue;
    }
    await queuePreparedRun(prepared);
    enqueuedCount += 1;
  }

  return enqueuedCount;
}

export function startTaskScheduleLoop(): { stop: () => Promise<void> } {
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
      const count = await runRecurringSchedulerOnce();
      if (count > 0) {
        console.log(`Recurring scheduler enqueued ${count} run(s)`);
      }
    })()
      .catch((error) => {
        console.error("Recurring scheduler loop failed", error);
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
  }, RECURRING_SCHEDULER_INTERVAL_MS);

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
