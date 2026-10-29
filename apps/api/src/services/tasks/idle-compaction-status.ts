import { query } from "../../lib/db.js";

// When the task's context was last compacted while idle, or null once a later model turn has run.
// The idle turn's own requests come before its completion log, so only later real turns hide it.
export async function loadLastIdleCompactionAt(taskId: string): Promise<string | null> {
  const result = await query<{ created_at: string }>(
    `WITH last_actual AS (
       SELECT created_at
         FROM task_events
        WHERE task_id = $1 AND type = 'context_usage' AND payload_json->>'source' = 'actual'
        ORDER BY created_at DESC, id DESC
        LIMIT 1
     )
     SELECT e.created_at
       FROM task_events e, last_actual a
      WHERE e.task_id = $1
        AND e.created_at >= a.created_at
        AND e.type = 'log'
        AND e.payload_json->>'trigger' = 'idle'
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 1`,
    [taskId]
  );
  return result.rows[0]?.created_at ?? null;
}
