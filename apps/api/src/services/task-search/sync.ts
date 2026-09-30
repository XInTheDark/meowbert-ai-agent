import type { FastifyBaseLogger } from "fastify";
import { query } from "../../lib/db.js";
import {
  ensureTaskSearchIndex,
  getTaskSearchSyncBatchSize,
  getTaskSearchSyncIntervalMs,
  isTaskSearchEnabled
} from "./client.js";
import { syncTaskSearchDocuments } from "./indexer.js";

const TASK_SEARCH_SYNC_MAX_ATTEMPTS = 3;

interface ClaimedTaskSearchSyncRow {
  task_id: string;
  locked_at: string | Date;
}

interface ClaimedTaskSearchSyncItem {
  taskId: string;
  lockedAt: string | Date;
}

async function claimTaskSearchSyncBatch(limit: number): Promise<ClaimedTaskSearchSyncItem[]> {
  const result = await query<ClaimedTaskSearchSyncRow>(
    `WITH claimed AS (
        SELECT task_id
          FROM task_search_sync_queue
         WHERE attempts < $2
           AND queued_at <= now()
           AND (
             locked_at IS NULL
             OR locked_at < now() - interval '5 minutes'
           )
         ORDER BY queued_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      UPDATE task_search_sync_queue q
         SET locked_at = now(),
             attempts = attempts + 1
        FROM claimed
       WHERE q.task_id = claimed.task_id
      RETURNING q.task_id, q.locked_at`,
    [limit, TASK_SEARCH_SYNC_MAX_ATTEMPTS]
  );

  return result.rows.map((row) => ({
    taskId: row.task_id,
    lockedAt: row.locked_at
  }));
}

async function completeTaskSearchSyncBatch(items: ClaimedTaskSearchSyncItem[]): Promise<void> {
  if (items.length === 0) {
    return;
  }

  await query(
    `DELETE FROM task_search_sync_queue
      WHERE (task_id, locked_at) IN (
        SELECT task_id, locked_at
          FROM unnest($1::uuid[], $2::timestamptz[]) AS claimed(task_id, locked_at)
      )`,
    [items.map((item) => item.taskId), items.map((item) => item.lockedAt)]
  );
}

async function failTaskSearchSyncBatch(items: ClaimedTaskSearchSyncItem[], error: unknown): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  await query(
    `UPDATE task_search_sync_queue
        SET locked_at = NULL,
            last_error = $2,
            queued_at = CASE
              WHEN attempts >= $3 THEN queued_at
              ELSE now() + make_interval(secs => LEAST(60, POWER(2, attempts)::int))
            END
       WHERE (task_id, locked_at) IN (
         SELECT task_id, locked_at
           FROM unnest($1::uuid[], $4::timestamptz[]) AS claimed(task_id, locked_at)
       )`,
    [
      items.map((item) => item.taskId),
      message.slice(0, 2000),
      TASK_SEARCH_SYNC_MAX_ATTEMPTS,
      items.map((item) => item.lockedAt)
    ]
  );
}

export function startTaskSearchSyncLoop(logger: FastifyBaseLogger): { stop: () => void } {
  if (!isTaskSearchEnabled()) {
    logger.info("[task-search] Meilisearch is not configured; task search sync is disabled.");
    return { stop: () => undefined };
  }

  const batchSize = getTaskSearchSyncBatchSize();
  const intervalMs = getTaskSearchSyncIntervalMs();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let indexReady = false;

  async function tick(): Promise<void> {
    if (stopped) {
      return;
    }

    try {
      if (!indexReady) {
        await ensureTaskSearchIndex();
        indexReady = true;
      }

      const claimedItems = await claimTaskSearchSyncBatch(batchSize);
      if (claimedItems.length > 0) {
        try {
          const taskIds = claimedItems.map((item) => item.taskId);
          await syncTaskSearchDocuments(taskIds);
          await completeTaskSearchSyncBatch(claimedItems);
        } catch (error) {
          await failTaskSearchSyncBatch(claimedItems, error);
          throw error;
        }
      }
    } catch (error) {
      logger.warn({ err: error }, "[task-search] Sync tick failed");
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void tick();
        }, intervalMs);
      }
    }
  }

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}
