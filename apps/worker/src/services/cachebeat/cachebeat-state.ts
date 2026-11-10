import { query } from "../../lib/db.js";

// Long enough to cover one beat request; a crashed worker's claim lapses on its own.
const CLAIM_SECONDS = 90;

export interface CachebeatState {
  cacheReadAtMs: number;
  beats: number;
  finished: boolean;
}

interface CachebeatRow {
  request_started_at: Date;
  cache_read_at: Date;
  beats: number;
  finished_at: Date | null;
}

// The task's beat state for the request it follows. A newer request starts a fresh idle period.
export async function loadCachebeatState(taskId: string, requestStartedAtMs: number): Promise<CachebeatState> {
  const result = await query<CachebeatRow>(
    "SELECT request_started_at, cache_read_at, beats, finished_at FROM task_cachebeats WHERE task_id = $1",
    [taskId]
  );
  const row = result.rows[0];
  if (!row || row.request_started_at.getTime() !== requestStartedAtMs) {
    return { cacheReadAtMs: requestStartedAtMs, beats: 0, finished: false };
  }
  return { cacheReadAtMs: row.cache_read_at.getTime(), beats: row.beats, finished: row.finished_at !== null };
}

// Takes the task's beat for this worker, or returns false while another worker holds it.
export async function claimCachebeat(taskId: string, requestStartedAtMs: number): Promise<boolean> {
  const startedAt = new Date(requestStartedAtMs);
  const result = await query(
    `INSERT INTO task_cachebeats (task_id, request_started_at, cache_read_at, claimed_until)
     VALUES ($1, $2, $2, now() + make_interval(secs => $3))
     ON CONFLICT (task_id) DO UPDATE
        SET request_started_at = EXCLUDED.request_started_at,
            cache_read_at = CASE WHEN task_cachebeats.request_started_at = EXCLUDED.request_started_at
                                 THEN task_cachebeats.cache_read_at ELSE EXCLUDED.cache_read_at END,
            beats = CASE WHEN task_cachebeats.request_started_at = EXCLUDED.request_started_at
                         THEN task_cachebeats.beats ELSE 0 END,
            finished_at = CASE WHEN task_cachebeats.request_started_at = EXCLUDED.request_started_at
                               THEN task_cachebeats.finished_at ELSE NULL END,
            last_outcome = CASE WHEN task_cachebeats.request_started_at = EXCLUDED.request_started_at
                                THEN task_cachebeats.last_outcome ELSE NULL END,
            claimed_until = EXCLUDED.claimed_until,
            updated_at = now()
      WHERE task_cachebeats.claimed_until IS NULL
         OR task_cachebeats.claimed_until < now()
         OR task_cachebeats.request_started_at <> EXCLUDED.request_started_at
     RETURNING task_id`,
    [taskId, startedAt, CLAIM_SECONDS]
  );
  return (result.rowCount ?? 0) > 0;
}

// Records how a claimed beat went and releases the claim.
export async function recordCachebeatOutcome(input: {
  taskId: string;
  requestStartedAtMs: number;
  outcome: string;
  reachedAtMs: number | null;
  finished: boolean;
}): Promise<void> {
  await query(
    `UPDATE task_cachebeats
        SET cache_read_at = COALESCE($3, cache_read_at),
            beats = beats + CASE WHEN $3::timestamptz IS NULL THEN 0 ELSE 1 END,
            last_outcome = $4,
            finished_at = CASE WHEN $5 THEN now() ELSE finished_at END,
            claimed_until = NULL,
            updated_at = now()
      WHERE task_id = $1 AND request_started_at = $2`,
    [input.taskId, new Date(input.requestStartedAtMs), input.reachedAtMs === null ? null : new Date(input.reachedAtMs), input.outcome, input.finished]
  );
}

// Marks the idle period finished without a beat, so idle compaction may run.
export async function finishCachebeat(taskId: string, requestStartedAtMs: number, reason: string): Promise<void> {
  const startedAt = new Date(requestStartedAtMs);
  await query(
    `INSERT INTO task_cachebeats (task_id, request_started_at, cache_read_at, last_outcome, finished_at)
     VALUES ($1, $2, $2, $3, now())
     ON CONFLICT (task_id) DO UPDATE
        SET request_started_at = EXCLUDED.request_started_at,
            cache_read_at = CASE WHEN task_cachebeats.request_started_at = EXCLUDED.request_started_at
                                 THEN task_cachebeats.cache_read_at ELSE EXCLUDED.cache_read_at END,
            beats = CASE WHEN task_cachebeats.request_started_at = EXCLUDED.request_started_at
                         THEN task_cachebeats.beats ELSE 0 END,
            last_outcome = EXCLUDED.last_outcome,
            finished_at = now(),
            updated_at = now()`,
    [taskId, startedAt, reason]
  );
}
