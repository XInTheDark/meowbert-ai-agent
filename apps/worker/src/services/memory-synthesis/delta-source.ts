import { query } from "../../lib/db.js";
import { readTaskPayloads } from "../tasks/task-history-reader.js";
import { MAX_DELTA_MESSAGES, type MemoryDeltaMessage } from "./delta.js";

// Tasks whose conversations must never reach Memory: Memory refresh tasks themselves, and
// incognito tasks together with every subtask, subagent or thread started under them (those
// children do not carry the incognito flag). Use inside a `WITH RECURSIVE` clause.
export function memoryExcludedTasksCte(environmentParam: string): string {
  return `memory_excluded_tasks AS (
       SELECT t.id
         FROM tasks t
        WHERE t.environment_id = ${environmentParam}
          AND (
            t.is_incognito = true
            OR EXISTS (SELECT 1 FROM memory_synthesis_requests msr WHERE msr.task_id = t.id)
          )
       UNION
       SELECT child.id
         FROM tasks child
         JOIN memory_excluded_tasks excluded
           ON child.parent_task_id = excluded.id
           OR child.workflow_parent_task_id = excluded.id
     )`;
}

export async function loadDelta(input: {
  environmentId: string;
  sourceAfter: string | null;
}): Promise<MemoryDeltaMessage[]> {
  const result = await query<MemoryDeltaMessage & { id: string; content_json: Record<string, unknown> }>(
    `WITH RECURSIVE ${memoryExcludedTasksCte("$1")}
     SELECT tm.id,
            tm.content_json,
            tm.task_id,
            tm.id AS message_id,
            tm.role,
            COALESCE(tm.content_json->>'text', '') AS text,
            tm.created_at,
            t.title AS task_title
       FROM task_messages tm
       JOIN tasks t ON t.id = tm.task_id
      WHERE t.environment_id = $1
        AND tm.role IN ('user', 'assistant')
        AND tm.created_at > COALESCE($2::timestamptz, to_timestamp(0))
        AND NOT EXISTS (SELECT 1 FROM memory_excluded_tasks excluded WHERE excluded.id = t.id)
      ORDER BY tm.created_at ASC, tm.id ASC
      LIMIT $3`,
    [input.environmentId, input.sourceAfter, MAX_DELTA_MESSAGES]
  );
  const restored = new Map<string, Record<string, unknown>>();
  for (const taskId of new Set(result.rows.map((row) => row.task_id))) {
    const rows = await readTaskPayloads(taskId, "messages", result.rows.filter((row) => row.task_id === taskId));
    for (const row of rows) restored.set(row.id, row.content_json);
  }
  return result.rows.map((row) => ({
    task_id: row.task_id,
    message_id: row.message_id,
    role: row.role,
    text: String(restored.get(row.id)?.text ?? ""),
    created_at: row.created_at,
    task_title: row.task_title
  }));
}
