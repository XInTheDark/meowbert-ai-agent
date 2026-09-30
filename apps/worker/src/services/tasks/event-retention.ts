import {
  TASK_EVENT_RETENTION_BACKLOG_INTERVAL_MS,
  TASK_EVENT_RETENTION_SAFETY_INTERVAL_MS,
  pruneTaskEvents
} from "@meowbert/shared";
import { query } from "../../lib/db.js";

export const EMAIL_DEBUG_EVENT_RETENTION_DAYS = 14;
export { TASK_EVENT_RETENTION_LIMIT } from "@meowbert/shared";

const EVENT_RETENTION_DELETE_LIMIT = 5_000;

function computeRetentionCutoffIso(nowMs = Date.now()): string {
  return new Date(nowMs - EMAIL_DEBUG_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export async function runTaskEventRetentionCleanupOnce(): Promise<number> {
  const result = await pruneTaskEvents(query);
  return result.deletedCount;
}

export async function runEmailDebugEventRetentionCleanupOnce(nowMs = Date.now()): Promise<number> {
  const cutoffIso = computeRetentionCutoffIso(nowMs);
  const result = await query(
    `WITH expired AS (
       SELECT id
         FROM email_inbound_debug_events
        WHERE created_at < $1::timestamptz
        ORDER BY created_at ASC, id ASC
        LIMIT $2
     )
     DELETE FROM email_inbound_debug_events de
      USING expired e
      WHERE de.id = e.id`,
    [cutoffIso, EVENT_RETENTION_DELETE_LIMIT]
  );

  return result.rowCount ?? 0;
}

export function startEventRetentionCleanupLoop(): { stop: () => Promise<void> } {
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
    let nextDelayMs = TASK_EVENT_RETENTION_SAFETY_INTERVAL_MS;
    pendingRun = Promise.all([
      runTaskEventRetentionCleanupOnce(),
      runEmailDebugEventRetentionCleanupOnce()
    ])
      .then(([taskDeleted, emailDeleted]) => {
        if (taskDeleted > 0) {
          nextDelayMs = TASK_EVENT_RETENTION_BACKLOG_INTERVAL_MS;
          console.log(`[event-retention] Pruned ${taskDeleted} excess task event(s)`);
        }
        if (emailDeleted > 0) {
          console.log(`[event-retention] Deleted ${emailDeleted} expired email debug event(s)`);
        }
      })
      .catch((error) => {
        console.error("[event-retention] Retention cleanup loop failed", error);
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
