import type { TaskExecutionTarget } from "@meowbert/shared";
import { query, withTransaction } from "../../../lib/db.js";
import { appendTaskEvent } from "../../runtime/events.js";
import type { ProjectCanvasIntent } from "../../canvases/project-canvases.js";
import { applyFollowUpTaskSettingsInTx } from "./follow-up-settings.js";

export interface TaskQueuedMessage {
  id: string;
  text: string;
  created_at: string;
}

const ACTIVE_RUN_STATUSES = new Set(["queued", "starting", "running"]);
// Runs that carry the conversation forward. Compaction, memory and reviewer runs are interrupted
// as before, since the user's message is not theirs to answer.
const QUEUEABLE_RUN_KINDS = new Set([
  "default",
  "scheduled_auto",
  "infinite_auto",
  "infinite_checkin",
  "long_horizon_clarify",
  "long_horizon_main",
  "agent_swarm_leader"
]);

// Live viewers reload the task when this log arrives; the worker sends it when it delivers the queue.
export async function announceTaskQueuedMessagesChanged(taskId: string): Promise<void> {
  await appendTaskEvent(taskId, "log", { message: "Queued messages changed.", phase: "queued_messages" });
}

// Queues a follow-up for the run already in flight, which picks it up before its next model turn.
// Returns null when there is no such run, or when the run cannot take one (a device run, a lane, a
// compaction or reviewer run, or a run already being stopped), so the caller sends it the usual way.
export async function queueTaskUserMessageIfRunActive(input: {
  taskId: string;
  userId: string;
  content: Record<string, unknown>;
  interactiveCanvasId?: string | null;
  interactiveCanvasIntent?: ProjectCanvasIntent | null;
  connectorContextId?: string | null;
}): Promise<{ queuedMessageId: string } | null> {
  const queued = await withTransaction(async (client) => {
    const taskRes = await client.query<{
      status: string;
      cancellation_requested: boolean;
      execution_target: TaskExecutionTarget | null;
      workflow_internal_role: string | null;
    }>(
      `SELECT status, cancellation_requested, execution_target, workflow_internal_role
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [input.taskId]
    );
    const task = taskRes.rows[0];
    if (
      !task
      || !ACTIVE_RUN_STATUSES.has(task.status)
      || task.cancellation_requested
      || task.execution_target?.kind === "local"
      || task.workflow_internal_role === "lane"
    ) {
      return null;
    }
    const runRes = await client.query<{ run_kind: string }>(
      `SELECT run_kind
         FROM task_runs
        WHERE task_id = $1
          AND ended_at IS NULL
        ORDER BY attempt_no DESC
        LIMIT 1`,
      [input.taskId]
    );
    if (!QUEUEABLE_RUN_KINDS.has(runRes.rows[0]?.run_kind ?? "")) {
      return null;
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO task_queued_messages (task_id, author_user_id, content_json)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id`,
      [input.taskId, input.userId, JSON.stringify(input.content)]
    );
    await applyFollowUpTaskSettingsInTx(client, input);
    return { queuedMessageId: inserted.rows[0].id };
  });
  if (queued) await announceTaskQueuedMessagesChanged(input.taskId);
  return queued;
}

export async function listTaskQueuedMessages(taskId: string): Promise<TaskQueuedMessage[]> {
  const result = await query<{ id: string; content_json: Record<string, unknown>; created_at: string }>(
    `SELECT id, content_json, created_at
       FROM task_queued_messages
      WHERE task_id = $1
      ORDER BY created_at, id`,
    [taskId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    text: typeof row.content_json.text === "string" ? row.content_json.text : "",
    created_at: row.created_at
  }));
}

// Removes a queued message before the run picks it up; null when the run already took it.
export async function takeTaskQueuedMessage(taskId: string, queuedMessageId: string): Promise<Record<string, unknown> | null> {
  const result = await query<{ content_json: Record<string, unknown> }>(
    `DELETE FROM task_queued_messages
      WHERE task_id = $1
        AND id = $2
      RETURNING content_json`,
    [taskId, queuedMessageId]
  );
  const content = result.rows[0]?.content_json ?? null;
  if (content) await announceTaskQueuedMessagesChanged(taskId);
  return content;
}
