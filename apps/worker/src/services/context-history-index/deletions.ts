import { query } from "../../lib/db.js";
import {
  dropHistoryIndex,
  deleteTasksFromHistoryIndex,
  historyIndexExists,
  openHistoryConnection,
  readDeletionCursor,
  withHistoryIndexWriteLock,
  writeDeletionCursor
} from "./storage.js";

// Archived and deleted tasks are queued in history_index_deletions by triggers, whichever path
// removed them. Every worker host keeps its own index, so each one applies the queue itself and
// remembers how far it got.

const LOOP_INTERVAL_MS = 60_000;
// Rows can commit a little after their created_at, so each pass looks back over this much.
const OVERLAP_MS = 10 * 60_000;
// Matches the row retention in migration 159.
const RETENTION_MS = 30 * 24 * 60 * 60_000;

async function readQueuedTasks(since: Date): Promise<{ checkedAt: Date; taskIds: string[] }> {
  const result = await query<{ checked_at: Date; task_ids: string[] }>(
    `SELECT now() AS checked_at,
            ARRAY(SELECT DISTINCT task_id::text FROM history_index_deletions WHERE created_at > $1) AS task_ids`,
    [since]
  );
  const row = result.rows[0];
  return { checkedAt: new Date(row.checked_at), taskIds: row.task_ids ?? [] };
}

export async function applyHistoryIndexDeletions(): Promise<void> {
  await query("DELETE FROM history_index_deletions WHERE created_at < now() - interval '30 days'");
  if (!await historyIndexExists()) return;
  await withHistoryIndexWriteLock(async () => {
    const cursor = await readDeletionCursor();
    const lastCheckedAt = cursor ? new Date(cursor.checkedAt) : new Date(0);
    const since = new Date(lastCheckedAt.getTime() - OVERLAP_MS);
    const { checkedAt, taskIds } = await readQueuedTasks(since);
    const connection = await openHistoryConnection();
    try {
      // A host that was away longer than the queue is kept may have missed deletions, so it
      // starts over; tasks are indexed again when they are next searched.
      if (cursor && checkedAt.getTime() - lastCheckedAt.getTime() > RETENTION_MS) await dropHistoryIndex(connection);
      else await deleteTasksFromHistoryIndex(connection, taskIds);
    } finally {
      connection.close();
    }
    await writeDeletionCursor({ checkedAt: checkedAt.toISOString() });
  });
}

export function startHistoryIndexDeletionLoop(): { stop: () => Promise<void> } {
  let stopping = false;
  let timer: NodeJS.Timeout | null = null;
  let pendingRun: Promise<void> | null = null;

  const runOnce = (): void => {
    timer = null;
    pendingRun = applyHistoryIndexDeletions()
      .catch((error: unknown) => {
        console.warn(`[history-index] Could not apply deletions: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        pendingRun = null;
        if (!stopping) timer = setTimeout(runOnce, LOOP_INTERVAL_MS);
      });
  };

  runOnce();
  return {
    stop: async () => {
      stopping = true;
      if (timer) clearTimeout(timer);
      await pendingRun;
    }
  };
}
