import type { PoolClient } from "pg";

// Remembers the chat each member last wrote to the Master from, so reports on the work they
// asked for go back there. A null connector context means the web. No-op for other tasks.
export async function recordProjectMasterReplyContextInTx(
  client: PoolClient,
  input: { taskId: string; userId: string; connectorContextId: string | null }
): Promise<void> {
  await client.query(
    `INSERT INTO project_master_reply_contexts (master_task_id, user_id, connector_context_id)
     SELECT task_id, $2, $3 FROM project_masters WHERE task_id = $1
     ON CONFLICT (master_task_id, user_id)
     DO UPDATE SET connector_context_id = EXCLUDED.connector_context_id, updated_at = now()`,
    [input.taskId, input.userId, input.connectorContextId]
  );
}
