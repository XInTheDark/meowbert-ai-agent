import type { PoolClient } from "pg";
import { withTransaction } from "../../../lib/db.js";

async function getNewestLeafMessageId(client: PoolClient, taskId: string): Promise<string | null> {
  const newestLeafRes = await client.query<{ id: string }>(
    `SELECT tm.id
       FROM task_messages tm
      WHERE tm.task_id = $1
        AND NOT EXISTS (
          SELECT 1
            FROM task_messages child
           WHERE child.task_id = tm.task_id
             AND child.parent_message_id = tm.id
        )
      ORDER BY tm.created_at DESC, tm.id DESC
      LIMIT 1`,
    [taskId]
  );

  return newestLeafRes.rows[0]?.id ?? null;
}

async function resolveNewestDescendantLeafMessageId(
  client: PoolClient,
  taskId: string,
  messageId: string
): Promise<string | null> {
  const leafRes = await client.query<{ id: string }>(
    `WITH RECURSIVE branch_messages AS (
        SELECT tm.id, tm.created_at
          FROM task_messages tm
         WHERE tm.task_id = $1
           AND tm.id = $2
        UNION ALL
        SELECT child.id, child.created_at
          FROM task_messages child
          JOIN branch_messages bm
            ON child.parent_message_id = bm.id
         WHERE child.task_id = $1
      )
      SELECT bm.id
        FROM branch_messages bm
       WHERE NOT EXISTS (
         SELECT 1
           FROM task_messages child
          WHERE child.task_id = $1
            AND child.parent_message_id = bm.id
       )
       ORDER BY bm.created_at DESC, bm.id DESC
       LIMIT 1`,
    [taskId, messageId]
  );

  return leafRes.rows[0]?.id ?? null;
}

// Only tool completions newer than the user's last explicit branch selection may override it;
// otherwise a tool call from the branch the user just left (e.g. before an edit) wins over the new branch.
async function resolveLatestRunningToolLeafMessageId(
  client: PoolClient,
  taskId: string,
  userId?: string | null
): Promise<string | null> {
  const latestToolRes = await client.query<{ id: string }>(
    `SELECT tm.id
       FROM tasks t
       JOIN task_events te
         ON te.task_id = t.id
        AND te.type = 'command_end'
       JOIN task_messages tm
         ON tm.task_id = t.id
        AND tm.content_json ->> 'callId' = te.payload_json ->> 'callId'
      WHERE t.id = $1
        AND t.status IN ('queued', 'starting', 'running')
        AND te.created_at > COALESCE(
          (SELECT tbs.updated_at
             FROM task_branch_selections tbs
            WHERE tbs.task_id = $1
              AND tbs.user_id = $2),
          '-infinity'::timestamptz
        )
      ORDER BY te.created_at DESC, te.id DESC
      LIMIT 1`,
    [taskId, userId ?? null]
  );
  const latestToolMessageId = latestToolRes.rows[0]?.id;
  if (!latestToolMessageId) {
    return null;
  }

  return resolveNewestDescendantLeafMessageId(client, taskId, latestToolMessageId);
}

export async function resolveActiveLeafMessageIdInTx(
  client: PoolClient,
  taskId: string,
  userId?: string | null
): Promise<string | null> {
  const latestRunningToolLeafMessageId = await resolveLatestRunningToolLeafMessageId(client, taskId, userId);
  if (latestRunningToolLeafMessageId) {
    return latestRunningToolLeafMessageId;
  }

  if (userId) {
    const selectedLeafRes = await client.query<{ active_leaf_message_id: string }>(
      `SELECT active_leaf_message_id
         FROM task_branch_selections
        WHERE task_id = $1
          AND user_id = $2`,
      [taskId, userId]
    );
    if ((selectedLeafRes.rowCount ?? 0) > 0) {
      const selectedLeafMessageId = selectedLeafRes.rows[0].active_leaf_message_id;
      const resolvedLeafMessageId = await resolveNewestDescendantLeafMessageId(client, taskId, selectedLeafMessageId);
      if (resolvedLeafMessageId) {
        if (resolvedLeafMessageId !== selectedLeafMessageId) {
          await client.query(
            `UPDATE task_branch_selections
                SET active_leaf_message_id = $3,
                    updated_at = now()
              WHERE task_id = $1
                AND user_id = $2`,
            [taskId, userId, resolvedLeafMessageId]
          );
        }
        return resolvedLeafMessageId;
      }
    }
  }

  return getNewestLeafMessageId(client, taskId);
}

export async function resolveActiveLeafMessageId(input: {
  taskId: string;
  userId?: string | null;
  client?: PoolClient;
}): Promise<string | null> {
  if (input.client) {
    return resolveActiveLeafMessageIdInTx(input.client, input.taskId, input.userId);
  }

  return withTransaction((client) => resolveActiveLeafMessageIdInTx(client, input.taskId, input.userId));
}

export async function setTaskBranchSelection(input: {
  taskId: string;
  userId: string;
  activeLeafMessageId: string;
  client?: PoolClient;
}): Promise<void> {
  const execute = async (client: PoolClient): Promise<void> => {
    await client.query(
      `INSERT INTO task_branch_selections (
        task_id,
        user_id,
        active_leaf_message_id
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (task_id, user_id)
      DO UPDATE
        SET active_leaf_message_id = EXCLUDED.active_leaf_message_id,
            updated_at = now()`,
      [input.taskId, input.userId, input.activeLeafMessageId]
    );
  };

  if (input.client) {
    await execute(input.client);
    return;
  }

  await withTransaction(execute);
}
