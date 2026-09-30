export const TASK_EVENT_RETENTION_LIMIT = 20;
export const TASK_EVENT_RETENTION_DELETE_LIMIT = 5_000;
export const TASK_EVENT_RETENTION_TASK_LIMIT = 100;
export const TASK_EVENT_INSERT_PRUNE_LIMIT = 100;
export const TASK_EVENT_RETENTION_BACKLOG_INTERVAL_MS = 60 * 1000;
export const TASK_EVENT_RETENTION_SAFETY_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface TaskEventRetentionSettingsRow {
  debug_mode: boolean;
}

interface TaskEventRetentionQueryResult<T extends object> {
  rows: T[];
  rowCount: number | null;
}

export type TaskEventRetentionQuery = <T extends object>(
  text: string,
  params?: unknown[]
) => Promise<TaskEventRetentionQueryResult<T>>;

export interface TaskEventRetentionResult {
  debugMode: boolean;
  deletedCount: number;
}

async function loadTaskEventRetentionDebugMode(
  runQuery: TaskEventRetentionQuery
): Promise<boolean> {
  const result = await runQuery<TaskEventRetentionSettingsRow>(
    `SELECT COALESCE(
       (SELECT debug_mode
          FROM platform_settings
         WHERE id = 1),
       false
     ) AS debug_mode`
  );

  return result.rows[0]?.debug_mode === true;
}

export async function pruneTaskEvents(
  runQuery: TaskEventRetentionQuery
): Promise<TaskEventRetentionResult> {
  const debugMode = await loadTaskEventRetentionDebugMode(runQuery);
  if (debugMode) {
    return { debugMode, deletedCount: 0 };
  }

  const result = await runQuery(
    `WITH candidate_tasks AS MATERIALIZED (
       SELECT t.id
         FROM tasks t
        WHERE NOT COALESCE(
          (SELECT debug_mode
             FROM platform_settings
            WHERE id = 1),
          false
        )
          AND EXISTS (
            SELECT 1
              FROM task_events probe
             WHERE probe.task_id = t.id
             ORDER BY probe.created_at DESC, probe.id DESC
            OFFSET $1
             LIMIT 1
          )
        ORDER BY t.task_history_last_active_at DESC, t.id ASC
        LIMIT $2
     ),
     expired AS (
       SELECT event.id
         FROM candidate_tasks task
         CROSS JOIN LATERAL (
           SELECT te.id
             FROM task_events te
            WHERE te.task_id = task.id
            ORDER BY te.created_at DESC, te.id DESC
           OFFSET $1
         ) event
        LIMIT $3
     )
     DELETE FROM task_events te
      USING expired e
      WHERE te.id = e.id`,
    [
      TASK_EVENT_RETENTION_LIMIT,
      TASK_EVENT_RETENTION_TASK_LIMIT,
      TASK_EVENT_RETENTION_DELETE_LIMIT
    ]
  );

  return {
    debugMode: false,
    deletedCount: result.rowCount ?? 0
  };
}
