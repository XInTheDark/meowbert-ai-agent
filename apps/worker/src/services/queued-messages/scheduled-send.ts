import { randomUUID } from "node:crypto";
import type { TaskExecutionJob } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { resolveContinuationBranchMessageId } from "../agent-db/index.js";
import { enqueueSubagentRun } from "../subagents/dispatch.js";
import { resolveContinuationModeForInterruptedTask } from "../task-schedules/service.js";
import { announceQueuedMessagesDelivered, claimQueuedUserMessages } from "./claim.js";

// Running tasks consume due messages through their inbox. Idle tasks need a new run; claiming the
// messages and recording its dispatch together makes delivery survive a worker or Redis restart.
async function sendScheduledMessages(taskId: string): Promise<void> {
  const delivered = await withTransaction(async (client) => {
    const taskRes = await client.query<{
      workspace_id: string; environment_id: string; initiator_user_id: string | null;
      workflow_type: string | null; phase: string | null;
    }>(
      `SELECT t.workspace_id, t.environment_id, t.initiator_user_id, t.workflow_type, w.phase
         FROM tasks t LEFT JOIN task_workflows w ON w.task_id = t.id
        WHERE t.id = $1 AND t.trashed_at IS NULL
          AND t.status NOT IN ('queued', 'starting', 'running')
          AND NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.task_id = t.id AND r.ended_at IS NULL)
        FOR UPDATE OF t SKIP LOCKED`, [taskId]
    );
    const task = taskRes.rows[0];
    if (!task) return false;
    const messages = await claimQueuedUserMessages(client, taskId, true);
    if (messages.length === 0) return false;
    const userId = messages.at(-1)?.authorUserId ?? task.initiator_user_id;
    let leaf = await resolveContinuationBranchMessageId(taskId, userId ?? undefined);
    for (const message of messages) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO task_messages(id, task_id, role, content_json, parent_message_id, author_user_id, message_metadata_json)
         VALUES ($1, $2, 'user', $3::jsonb, $4, $5, $6::jsonb)`,
        [id, taskId, JSON.stringify(message.content), leaf, message.authorUserId ?? null, JSON.stringify(message.metadata)]
      );
      leaf = id;
    }
    if (userId) await client.query(
      `INSERT INTO task_branch_selections(task_id, user_id, active_leaf_message_id) VALUES ($1, $2, $3)
       ON CONFLICT (task_id, user_id) DO UPDATE SET active_leaf_message_id = EXCLUDED.active_leaf_message_id, updated_at = now()`,
      [taskId, userId, leaf]
    );
    await client.query(
      `UPDATE tasks SET time_limit_deadline_at = CASE WHEN time_limit_seconds IS NOT NULL
         THEN now() + make_interval(secs => time_limit_seconds) ELSE NULL END
       WHERE id = $1 OR workflow_parent_task_id = $1`, [taskId]
    );
    const workflowMode: TaskExecutionJob["mode"] = task.workflow_type === "agent_swarm" ? "agent_swarm_leader"
      : task.workflow_type ? (task.phase === "clarify" ? "long_horizon_clarify" : "long_horizon_main") : "default";
    await enqueueSubagentRun(client, {
      taskId, workspaceId: task.workspace_id, environmentId: task.environment_id, triggerSource: "web",
      mode: await resolveContinuationModeForInterruptedTask(taskId, workflowMode),
      branchMessageId: leaf!, selectionUserId: userId ?? undefined
    });
    return true;
  });
  if (delivered) await announceQueuedMessagesDelivered(taskId);
}

export async function sendDueScheduledMessages(): Promise<void> {
  const due = await query<{ task_id: string }>(
    `SELECT q.task_id FROM task_queued_messages q JOIN tasks t ON t.id = q.task_id
      WHERE q.send_at <= now() AND t.trashed_at IS NULL AND t.status NOT IN ('queued', 'starting', 'running')
        AND NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.task_id = t.id AND r.ended_at IS NULL)
      GROUP BY q.task_id ORDER BY MIN(q.send_at) LIMIT 100`
  );
  for (const row of due.rows) {
    try { await sendScheduledMessages(row.task_id); }
    catch (error) { console.error("Scheduled send failed", row.task_id, error); }
  }
}
