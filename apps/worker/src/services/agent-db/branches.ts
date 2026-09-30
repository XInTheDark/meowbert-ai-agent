import { query } from "../../lib/db.js";
import { getNewestLeafMessageId, resolveNewestDescendantLeafMessageId } from "./messages.js";

export async function resolveContinuationBranchMessageId(
  taskId: string,
  selectionUserId?: string
): Promise<string | null> {
  if (selectionUserId) {
    const selectedLeafRes = await query<{ active_leaf_message_id: string }>(
      `SELECT active_leaf_message_id
         FROM task_branch_selections
        WHERE task_id = $1
          AND user_id = $2`,
      [taskId, selectionUserId]
    );
    if ((selectedLeafRes.rowCount ?? 0) > 0) {
      const selectedLeafMessageId = selectedLeafRes.rows[0].active_leaf_message_id;
      const resolvedLeafMessageId = await resolveNewestDescendantLeafMessageId(taskId, selectedLeafMessageId);
      if (resolvedLeafMessageId) {
        return resolvedLeafMessageId;
      }
    }
  }

  return getNewestLeafMessageId(taskId);
}

export async function setTaskBranchSelection(taskId: string, userId: string, activeLeafMessageId: string): Promise<void> {
  await query(
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
    [taskId, userId, activeLeafMessageId]
  );
}

export async function resolveLatestBranchSelectionUserId(taskId: string): Promise<string | null> {
  const result = await query<{ user_id: string }>(
    `SELECT user_id
       FROM task_branch_selections
      WHERE task_id = $1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [taskId]
  );

  return result.rows[0]?.user_id ?? null;
}
