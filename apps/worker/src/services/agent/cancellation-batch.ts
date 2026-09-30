import { query } from "../../lib/db.js";

export type RunCancellationReason = "explicit_cancel" | "newer_attempt";
interface WatchedRun {
  taskId: string;
  runId: string;
  notify: (reason: RunCancellationReason) => void;
}

const watched = new Set<WatchedRun>();
let timer: NodeJS.Timeout | null = null;
let checking = false;

function scheduleCheck(): void {
  if (timer || checking || watched.size === 0) return;
  timer = setTimeout(() => {
    timer = null;
    void checkRuns();
  }, 500);
  timer.unref();
}

async function checkRuns(): Promise<void> {
  const snapshot = [...watched];
  if (snapshot.length === 0) return;
  checking = true;
  try {
    const result = await query<{
      id: string;
      task_id: string;
      cancellation_requested: boolean;
      is_latest: boolean;
    }>(
      `SELECT r.id, r.task_id, t.cancellation_requested,
              r.ended_at IS NULL AND NOT EXISTS (
                SELECT 1 FROM task_runs newer
                 WHERE newer.task_id = r.task_id AND newer.attempt_no > r.attempt_no
              ) AS is_latest
         FROM task_runs r JOIN tasks t ON t.id = r.task_id
        WHERE r.id = ANY($1::uuid[])`,
      [[...new Set(snapshot.map((run) => run.runId))]]
    );
    const rows = new Map(result.rows.map((row) => [row.id, row]));
    for (const run of snapshot) {
      if (!watched.has(run)) continue;
      const row = rows.get(run.runId);
      const reason = row?.task_id === run.taskId && row.cancellation_requested
        ? "explicit_cancel"
        : !row || row.task_id !== run.taskId || !row.is_latest ? "newer_attempt" : null;
      if (reason) {
        watched.delete(run);
        run.notify(reason);
      }
    }
  } catch {
    // Synchronous assertions still enforce cancellation during a database outage.
  } finally {
    checking = false;
    scheduleCheck();
  }
}

export function watchRunCancellation(taskId: string, runId: string, notify: WatchedRun["notify"]): () => void {
  const run = { taskId, runId, notify };
  watched.add(run);
  scheduleCheck();
  return () => {
    watched.delete(run);
    if (watched.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
