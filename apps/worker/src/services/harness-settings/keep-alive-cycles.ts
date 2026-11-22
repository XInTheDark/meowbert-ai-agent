import { computeKeepAliveDelaySeconds } from "@meowbert/shared";
import { withTransaction } from "../../lib/db.js";
import { calculateTaskRunRetryDelayMs, type TaskRunRetryPolicy } from "../tasks/task-run-retry.js";
import { harnessLimits } from "./service.js";

// Times the next cycle of a keep-alive task. Keep-alive is a Timed schedule, so the scheduler
// loop starts the cycle once next_run_at is due.

interface ActiveKeepAliveRow {
  wake_interval_seconds: number | null;
  idle_cycle_count: number;
  failed_cycle_count: number;
  run_deadline_at: string | Date;
}

// A failed cycle already used its run retries, so the next cycle waits minutes, not seconds.
const FAILED_CYCLE_RETRY_POLICY: TaskRunRetryPolicy = { baseDelayMs: 60_000, maxDelayMs: 15 * 60_000 };

const ACTIVE_KEEP_ALIVE_SQL = `
  SELECT wake_interval_seconds, idle_cycle_count, failed_cycle_count, run_deadline_at
    FROM task_schedules
   WHERE task_id = $1
     AND mode = 'infinite'
     AND run_timeout_seconds IS NOT NULL
     AND schedule_state = 'active'
     AND run_deadline_at > now()
   FOR UPDATE`;

function capAtDeadline(deadline: string | Date, delaySeconds: number): Date {
  const next = Date.now() + delaySeconds * 1000;
  return new Date(Math.min(next, new Date(deadline).getTime()));
}

// After a cycle that ended with final_response: wait the wake interval, longer after idle cycles.
export async function scheduleNextKeepAliveCycle(taskId: string, input: { idle: boolean; budgetExhausted: boolean }): Promise<string | null> {
  return withTransaction(async (client) => {
    const row = (await client.query<ActiveKeepAliveRow>(ACTIVE_KEEP_ALIVE_SQL, [taskId])).rows[0];
    if (!row) return null;
    if (input.budgetExhausted) {
      await client.query(
        `UPDATE task_schedules
            SET schedule_state = 'paused', next_run_at = NULL, run_deadline_at = NULL, pending_run = false, updated_at = now()
          WHERE task_id = $1`,
        [taskId]
      );
      return null;
    }
    const idleCycles = input.idle ? row.idle_cycle_count + 1 : 0;
    const delaySeconds = computeKeepAliveDelaySeconds({
      wakeIntervalSeconds: row.wake_interval_seconds,
      // The first idle cycle still waits the base delay; backoff starts from the second.
      idleCycles: Math.max(0, idleCycles - 1)
    });
    const nextRunAt = capAtDeadline(row.run_deadline_at, delaySeconds);
    await client.query(
      `UPDATE task_schedules
          SET next_run_at = $2, pending_run = false, idle_cycle_count = $3, failed_cycle_count = 0,
              last_wake_reason = 'interval', updated_at = now()
        WHERE task_id = $1`,
      [taskId, nextRunAt.toISOString(), idleCycles]
    );
    return nextRunAt.toISOString();
  });
}

export type FailedKeepAliveCycleOutcome =
  | { kind: "not_keep_alive" }
  | { kind: "scheduled"; nextRunAt: string; failedCycles: number }
  | { kind: "paused"; failedCycles: number };

// After a cycle whose retries ran out: try again later, until too many cycles in a row have failed.
export async function scheduleKeepAliveAfterFailure(taskId: string): Promise<FailedKeepAliveCycleOutcome> {
  return withTransaction(async (client) => {
    const row = (await client.query<ActiveKeepAliveRow>(ACTIVE_KEEP_ALIVE_SQL, [taskId])).rows[0];
    if (!row) return { kind: "not_keep_alive" };
    const failedCycles = row.failed_cycle_count + 1;
    if (failedCycles >= harnessLimits().maxFailedKeepAliveCycles) {
      await client.query(
        `UPDATE task_schedules
            SET schedule_state = 'paused', next_run_at = NULL, run_deadline_at = NULL, pending_run = false,
                failed_cycle_count = $2, updated_at = now()
          WHERE task_id = $1`,
        [taskId, failedCycles]
      );
      return { kind: "paused", failedCycles };
    }
    const delayMs = calculateTaskRunRetryDelayMs(failedCycles, FAILED_CYCLE_RETRY_POLICY);
    const nextRunAt = capAtDeadline(row.run_deadline_at, Math.ceil(delayMs / 1000));
    await client.query(
      `UPDATE task_schedules
          SET next_run_at = $2, pending_run = false, failed_cycle_count = $3,
              last_wake_reason = 'failure', updated_at = now()
        WHERE task_id = $1`,
      [taskId, nextRunAt.toISOString(), failedCycles]
    );
    return { kind: "scheduled", nextRunAt: nextRunAt.toISOString(), failedCycles };
  });
}
