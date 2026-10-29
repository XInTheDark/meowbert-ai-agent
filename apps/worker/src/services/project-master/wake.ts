import type { PoolClient } from "pg";
import type { TaskStatus } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { enqueueSubagentRun } from "../subagents/dispatch.js";

// Wait for a quiet moment so reports from tasks finishing together arrive in one Master run.
const REPORT_QUIET_SECONDS = 10;
const REPORT_MAX_DELAY_SECONDS = 60;

// "skipped" covers a busy, disabled, or empty Master. A later notification brings it back.
export type MasterWakeOutcome =
  | { kind: "woken" }
  | { kind: "due_later"; delayMs: number }
  | { kind: "skipped" };

export interface IdleMaster {
  workspace_id: string;
  environment_id: string;
  initiator_user_id: string | null;
  status: TaskStatus;
}

async function lockIdleEnabledMaster(client: PoolClient, masterTaskId: string): Promise<IdleMaster | null> {
  const result = await client.query<IdleMaster>(
    `SELECT t.workspace_id, t.environment_id, t.initiator_user_id, t.status
       FROM tasks t
       LEFT JOIN workspace_settings ws ON ws.workspace_id = t.workspace_id
      WHERE t.id = $1
        AND t.trashed_at IS NULL
        AND t.status NOT IN ('queued', 'starting', 'running')
        AND COALESCE(ws.model_defaults_json->>'projectMasterEnabled', 'true') <> 'false'
        AND NOT EXISTS (SELECT 1 FROM task_runs tr WHERE tr.task_id = t.id AND tr.ended_at IS NULL)
        FOR UPDATE OF t`,
    [masterTaskId]
  );
  return result.rows[0] ?? null;
}

// The run serves whoever asked for the oldest pending report; the rest wait for the next run.
async function loadPendingReports(
  client: PoolClient,
  masterTaskId: string
): Promise<{ dueInMs: number; requestedByUserId: string | null } | null> {
  const result = await client.query<{ due_in_ms: number; requested_by_user_id: string | null }>(
    `SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM LEAST(
              MAX(created_at) + make_interval(secs => $2),
              MIN(created_at) + make_interval(secs => $3)
            ) - now()) * 1000))::int AS due_in_ms,
            (ARRAY_AGG(requested_by_user_id ORDER BY created_at, id))[1] AS requested_by_user_id
       FROM project_master_reports
      WHERE master_task_id = $1 AND delivered_at IS NULL
     HAVING COUNT(*) > 0`,
    [masterTaskId, REPORT_QUIET_SECONDS, REPORT_MAX_DELAY_SECONDS]
  );
  const row = result.rows[0];
  return row ? { dueInMs: row.due_in_ms, requestedByUserId: row.requested_by_user_id } : null;
}

// Runs as the member who asked for the work and replies in the chat they last used. Reports with
// no requester, or one who has left the workspace, fall back to whoever last viewed the Master.
export async function resolveWakeRoute(
  client: PoolClient,
  masterTaskId: string,
  master: IdleMaster,
  requestedByUserId: string | null
): Promise<{ userId: string | undefined; replyContext?: { connectorContextId: string | null } }> {
  if (requestedByUserId) {
    const route = await client.query<{ connector_context_id: string | null; has_reply_context: boolean }>(
      `SELECT rc.connector_context_id, rc.user_id IS NOT NULL AS has_reply_context
         FROM workspace_members wm
         LEFT JOIN project_master_reply_contexts rc ON rc.master_task_id = $1 AND rc.user_id = wm.user_id
        WHERE wm.workspace_id = $2 AND wm.user_id = $3`,
      [masterTaskId, master.workspace_id, requestedByUserId]
    );
    const row = route.rows[0];
    if (row) {
      return {
        userId: requestedByUserId,
        replyContext: row.has_reply_context ? { connectorContextId: row.connector_context_id } : undefined
      };
    }
  }
  const selection = await client.query<{ user_id: string }>(
    "SELECT user_id FROM task_branch_selections WHERE task_id = $1 ORDER BY updated_at DESC LIMIT 1",
    [masterTaskId]
  );
  return { userId: selection.rows[0]?.user_id ?? master.initiator_user_id ?? undefined };
}

export async function wakeMasterIfDue(masterTaskId: string): Promise<MasterWakeOutcome> {
  return withTransaction(async (client): Promise<MasterWakeOutcome> => {
    const master = await lockIdleEnabledMaster(client, masterTaskId);
    if (!master) return { kind: "skipped" };
    const pending = await loadPendingReports(client, masterTaskId);
    if (!pending) return { kind: "skipped" };
    if (pending.dueInMs > 0) return { kind: "due_later", delayMs: pending.dueInMs };

    const route = await resolveWakeRoute(client, masterTaskId, master, pending.requestedByUserId);
    if (route.replyContext) {
      // The run reads its reply chat when it starts, so a message arriving mid-run cannot redirect it.
      await client.query(
        "UPDATE tasks SET connector_context_id = $2 WHERE id = $1",
        [masterTaskId, route.replyContext.connectorContextId]
      );
    }
    // Reports are appended by the inbox at the first model turn, on this member's branch.
    await enqueueSubagentRun(client, {
      taskId: masterTaskId,
      workspaceId: master.workspace_id,
      environmentId: master.environment_id,
      triggerSource: "web",
      mode: "default",
      selectionUserId: route.userId
    });
    return { kind: "woken" };
  });
}

// Idle, enabled Masters with undelivered reports, for catching up after a restart or a missed
// notification. Busy or disabled Masters are left out so they cannot crowd the batch.
export async function listMastersWithPendingReports(limit: number): Promise<string[]> {
  const result = await query<{ master_task_id: string }>(
    `SELECT r.master_task_id
       FROM project_master_reports r
       JOIN tasks m ON m.id = r.master_task_id
       LEFT JOIN workspace_settings ws ON ws.workspace_id = m.workspace_id
      WHERE r.delivered_at IS NULL
        AND m.trashed_at IS NULL
        AND m.status NOT IN ('queued', 'starting', 'running')
        AND COALESCE(ws.model_defaults_json->>'projectMasterEnabled', 'true') <> 'false'
      GROUP BY r.master_task_id
      ORDER BY MIN(r.created_at)
      LIMIT $1`,
    [limit]
  );
  return result.rows.map((row) => row.master_task_id);
}
