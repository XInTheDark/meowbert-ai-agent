import { query } from "../../lib/db.js";

export interface LineageUserMessage {
  id: string;
  content_json: Record<string, unknown>;
  parent_message_id: string | null;
}

export async function listTaskMessageLineageIds(
  taskId: string,
  messageId: string
): Promise<string[]> {
  const result = await query<{ id: string }>(
    `WITH RECURSIVE lineage AS (
      SELECT id, parent_message_id, 0 AS depth
        FROM task_messages
       WHERE task_id = $1
         AND id = $2
      UNION ALL
      SELECT tm.id, tm.parent_message_id, lineage.depth + 1 AS depth
        FROM task_messages tm
        JOIN lineage
          ON lineage.parent_message_id = tm.id
       WHERE tm.task_id = $1
    )
    SELECT id
      FROM lineage
     ORDER BY depth DESC`,
    [taskId, messageId]
  );

  return result.rows.map((row) => row.id);
}

export async function findNearestUserAncestorMessage(
  taskId: string,
  messageId: string
): Promise<LineageUserMessage | null> {
  const result = await query<LineageUserMessage>(
    `WITH RECURSIVE lineage AS (
      SELECT id, role, content_json, parent_message_id, 0 AS depth
        FROM task_messages
       WHERE task_id = $1
         AND id = $2
      UNION ALL
      SELECT tm.id, tm.role, tm.content_json, tm.parent_message_id, lineage.depth + 1 AS depth
        FROM task_messages tm
        JOIN lineage
          ON lineage.parent_message_id = tm.id
       WHERE tm.task_id = $1
    )
    SELECT id, content_json, parent_message_id
      FROM lineage
     WHERE role = 'user'
     ORDER BY depth ASC
     LIMIT 1`,
    [taskId, messageId]
  );

  return result.rows[0] ?? null;
}
