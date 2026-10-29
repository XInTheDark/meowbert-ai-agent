import { randomUUID } from "node:crypto";
import type { TaskExecutionJob } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import {
  enqueueContinuationRun,
  resolveContinuationBranchMessageId,
  resolveLatestBranchSelectionUserId
} from "../agent-db/index.js";
import { resolveContinuationModeForInterruptedTask } from "../task-schedules/service.js";
import { announceQueuedMessagesDelivered, claimQueuedUserMessages } from "./claim.js";

// A newer run takes the queue at its first turn; a stopped task keeps it for the user to send or drop.
const KEEP_QUEUE_STATUSES = new Set(["queued", "starting", "running", "cancelled"]);

async function appendQueuedMessagesAfterRun(
  taskId: string,
  leafMessageId: string | null,
  selectionUserId: string | null
): Promise<{ previousStatus: string; branchMessageId: string } | null> {
  return withTransaction(async (client) => {
    const taskRes = await client.query<{ status: string }>("SELECT status FROM tasks WHERE id = $1 FOR UPDATE", [taskId]);
    const previousStatus = taskRes.rows[0]?.status;
    if (!previousStatus || KEEP_QUEUE_STATUSES.has(previousStatus)) return null;
    const messages = await claimQueuedUserMessages(client, taskId);
    if (messages.length === 0) return null;

    let parentMessageId = leafMessageId;
    for (const message of messages) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO task_messages(id, task_id, role, content_json, parent_message_id, author_user_id, message_metadata_json)
         VALUES ($1, $2, 'user', $3::jsonb, $4, $5, $6::jsonb)`,
        [id, taskId, JSON.stringify(message.content), parentMessageId, message.authorUserId ?? null, JSON.stringify(message.metadata ?? null)]
      );
      parentMessageId = id;
    }
    if (selectionUserId) {
      await client.query(
        `INSERT INTO task_branch_selections (task_id, user_id, active_leaf_message_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (task_id, user_id)
         DO UPDATE SET active_leaf_message_id = EXCLUDED.active_leaf_message_id, updated_at = now()`,
        [taskId, selectionUserId, parentMessageId]
      );
    }
    // Follow-ups sent before the next run exists keep queueing for it instead of starting their own.
    await client.query("UPDATE tasks SET status = 'queued', updated_at = now() WHERE id = $1", [taskId]);
    return { previousStatus, branchMessageId: parentMessageId as string };
  });
}

// Messages queued after the run's last model turn start the next run once this one has settled,
// just as if the user had sent them after it finished.
export async function startRunForQueuedMessages(job: TaskExecutionJob): Promise<void> {
  const selectionUserId = (await resolveLatestBranchSelectionUserId(job.taskId)) ?? job.selectionUserId ?? null;
  const leafMessageId = await resolveContinuationBranchMessageId(job.taskId, selectionUserId ?? undefined);
  const handoff = await appendQueuedMessagesAfterRun(job.taskId, leafMessageId, selectionUserId);
  if (!handoff) return;
  await announceQueuedMessagesDelivered(job.taskId);

  try {
    await enqueueContinuationRun(job, {
      mode: await resolveContinuationModeForInterruptedTask(job.taskId, job.mode),
      branchMessageId: handoff.branchMessageId,
      selectionUserId,
      toolOptionsOverride: null
    });
  } catch (error) {
    await query("UPDATE tasks SET status = $2, updated_at = now() WHERE id = $1 AND status = 'queued'", [job.taskId, handoff.previousStatus]);
    const message = error instanceof Error ? error.message : String(error);
    await emitTaskEvent(job.taskId, "error", { message: `Failed to send queued messages: ${message}` });
  }
}
