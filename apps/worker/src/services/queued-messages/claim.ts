import type { PoolClient } from "pg";
import { createTaskMessageMetadata } from "@meowbert/shared";
import { emitTaskEvent } from "../runtime/events.js";
import type { RunInboxMessage } from "../agent/run-inbox.js";

// Takes every follow-up queued for a task, oldest first, as user messages ready to append.
export async function claimQueuedUserMessages(client: PoolClient, taskId: string): Promise<RunInboxMessage[]> {
  const claimed = await client.query<{ author_user_id: string | null; content_json: Record<string, unknown> }>(
    `WITH claimed AS (
       DELETE FROM task_queued_messages
        WHERE task_id = $1
        RETURNING id, author_user_id, content_json, created_at
     )
     SELECT author_user_id, content_json FROM claimed ORDER BY created_at, id`,
    [taskId]
  );
  const deliveredAt = new Date().toISOString();
  return claimed.rows.map((row): RunInboxMessage => ({
      role: "user",
      content: row.content_json,
      authorUserId: row.author_user_id,
      metadata: { ...createTaskMessageMetadata(deliveredAt) }
    }));
}

// Live viewers reload the task, dropping the delivered messages from their queue.
export async function announceQueuedMessagesDelivered(taskId: string): Promise<void> {
  await emitTaskEvent(taskId, "log", { message: "Queued messages delivered.", phase: "queued_messages" });
}
