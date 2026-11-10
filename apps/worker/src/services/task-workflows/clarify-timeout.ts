import type { PoolClient } from "pg";
import { query, withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import {
  appendMessage,
  resolveContinuationBranchMessageId,
  resolveLatestBranchSelectionUserId
} from "../agent-db/index.js";
import { enqueueWorkflowTaskRun } from "./shared.js";

export const CLARIFY_TIMEOUT_MINUTES = 15;
const CLARIFY_TIMEOUT_INTERVAL_MS = 30_000;
const CLARIFY_TIMEOUT_BATCH_SIZE = 50;
const CLARIFY_TIMEOUT_MESSAGE =
  `No reply after ${CLARIFY_TIMEOUT_MINUTES} minutes. Go ahead on your best assumptions and start the plan.`;

interface ClarifyTimeoutTask {
  id: string;
  workspace_id: string;
  environment_id: string;
}

// Long-horizon tasks still in the clarify phase whose latest run ended before the cutoff and
// have nothing running or queued, so they are only waiting on the user.
async function listTimedOutClarifyTasks(): Promise<ClarifyTimeoutTask[]> {
  const result = await query<ClarifyTimeoutTask>(
    `SELECT t.id, t.workspace_id, t.environment_id
       FROM tasks t
       JOIN task_workflows w ON w.task_id = t.id
      WHERE t.status = 'awaiting_input'
        AND t.workflow_type = 'long_horizon'
        AND t.workflow_parent_task_id IS NULL
        AND t.trashed_at IS NULL
        AND w.phase = 'clarify'
        AND NOT EXISTS (SELECT 1 FROM task_runs tr WHERE tr.task_id = t.id AND tr.ended_at IS NULL)
        AND (SELECT MAX(tr.ended_at) FROM task_runs tr WHERE tr.task_id = t.id)
              <= now() - make_interval(mins => $1)
      ORDER BY t.updated_at ASC
      LIMIT $2`,
    [CLARIFY_TIMEOUT_MINUTES, CLARIFY_TIMEOUT_BATCH_SIZE]
  );
  return result.rows;
}

// Claims the task and appends the note under the task lock, so a reply that lands first wins.
async function appendTimeoutNoteInTx(
  client: PoolClient,
  taskId: string,
  parentMessageId: string | null,
  selectionUserId: string | null
): Promise<string | null> {
  const taskRes = await client.query<{ status: string }>(
    `SELECT t.status
       FROM tasks t
       JOIN task_workflows w ON w.task_id = t.id
      WHERE t.id = $1 AND w.phase = 'clarify'
      FOR UPDATE OF t`,
    [taskId]
  );
  if (taskRes.rows[0]?.status !== "awaiting_input") {
    return null;
  }

  const messageId = await appendMessage(taskId, "user", { text: CLARIFY_TIMEOUT_MESSAGE }, {
    client,
    parentMessageId
  });
  if (selectionUserId) {
    await client.query(
      `INSERT INTO task_branch_selections (task_id, user_id, active_leaf_message_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (task_id, user_id)
       DO UPDATE SET active_leaf_message_id = EXCLUDED.active_leaf_message_id, updated_at = now()`,
      [taskId, selectionUserId, messageId]
    );
  }
  await client.query("UPDATE tasks SET status = 'queued', updated_at = now() WHERE id = $1", [taskId]);
  return messageId;
}

async function resumeTimedOutClarifyTask(task: ClarifyTimeoutTask): Promise<boolean> {
  const selectionUserId = await resolveLatestBranchSelectionUserId(task.id);
  const leafMessageId = await resolveContinuationBranchMessageId(task.id, selectionUserId ?? undefined);
  const messageId = await withTransaction((client) =>
    appendTimeoutNoteInTx(client, task.id, leafMessageId, selectionUserId)
  );
  if (!messageId) {
    return false;
  }

  try {
    await enqueueWorkflowTaskRun({
      taskId: task.id,
      workspaceId: task.workspace_id,
      environmentId: task.environment_id,
      triggerSource: "web",
      mode: "long_horizon_clarify",
      branchMessageId: messageId,
      selectionUserId
    });
  } catch (error) {
    await query("UPDATE tasks SET status = 'awaiting_input', updated_at = now() WHERE id = $1 AND status = 'queued'", [task.id]);
    console.error(`[clarify-timeout] Failed to resume ${task.id}`, error);
    return false;
  }

  await emitTaskEvent(task.id, "status", { status: "queued" }).catch(() => undefined);
  return true;
}

export async function runClarifyTimeoutSweepOnce(): Promise<number> {
  let resumed = 0;
  for (const task of await listTimedOutClarifyTasks()) {
    if (await resumeTimedOutClarifyTask(task)) {
      resumed += 1;
    }
  }
  return resumed;
}

export function startClarifyTimeoutLoop(): { stop: () => Promise<void> } {
  let stopping = false;
  let pendingRun: Promise<void> | null = null;

  const runOnce = (): void => {
    if (stopping || pendingRun) {
      return;
    }
    pendingRun = runClarifyTimeoutSweepOnce()
      .then((resumed) => {
        if (resumed > 0) {
          console.log(`[clarify-timeout] Resumed ${resumed} long-horizon task(s) after no reply`);
        }
      })
      .catch((error) => console.error("[clarify-timeout] Sweep failed", error))
      .finally(() => {
        pendingRun = null;
      });
  };

  runOnce();
  const interval = setInterval(runOnce, CLARIFY_TIMEOUT_INTERVAL_MS);

  return {
    stop: async (): Promise<void> => {
      stopping = true;
      clearInterval(interval);
      await pendingRun;
    }
  };
}
