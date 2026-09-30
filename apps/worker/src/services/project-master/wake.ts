import { query, withTransaction } from "../../lib/db.js";
import { enqueueSubagentRun } from "../subagents/dispatch.js";

const WAKE_INTERVAL_MS = 3_000;
// Wait for a quiet moment so reports from tasks finishing together arrive in one Master run.
const REPORT_QUIET_SECONDS = 10;
const REPORT_MAX_DELAY_SECONDS = 60;

async function wakeMaster(masterTaskId: string): Promise<void> {
  await withTransaction(async (client) => {
    const taskRes = await client.query<{
      workspace_id: string; environment_id: string; initiator_user_id: string | null; status: string;
    }>(
      "SELECT workspace_id, environment_id, initiator_user_id, status FROM tasks WHERE id = $1 FOR UPDATE",
      [masterTaskId]
    );
    const master = taskRes.rows[0];
    if (!master || ["queued", "starting", "running"].includes(master.status)) return;
    const open = await client.query("SELECT id FROM task_runs WHERE task_id = $1 AND ended_at IS NULL LIMIT 1", [masterTaskId]);
    if (open.rowCount) return;
    const pending = await client.query(
      "SELECT id FROM project_master_reports WHERE master_task_id = $1 AND delivered_at IS NULL LIMIT 1",
      [masterTaskId]
    );
    if (!pending.rowCount) return;
    const selection = await client.query<{ user_id: string }>(
      "SELECT user_id FROM task_branch_selections WHERE task_id = $1 ORDER BY updated_at DESC LIMIT 1",
      [masterTaskId]
    );
    // Reports are appended by the inbox at the first model turn, on the latest branch.
    await enqueueSubagentRun(client, {
      taskId: masterTaskId,
      workspaceId: master.workspace_id,
      environmentId: master.environment_id,
      triggerSource: "web",
      mode: "default",
      selectionUserId: selection.rows[0]?.user_id ?? master.initiator_user_id ?? undefined
    });
  });
}

export async function wakeProjectMastersOnce(): Promise<void> {
  const candidates = await query<{ master_task_id: string }>(
    `SELECT r.master_task_id
       FROM project_master_reports r
       JOIN tasks m ON m.id = r.master_task_id
       JOIN workspace_settings ws ON ws.workspace_id = m.workspace_id
      WHERE r.delivered_at IS NULL
        AND m.trashed_at IS NULL
        AND m.status NOT IN ('queued', 'starting', 'running')
        AND COALESCE(ws.model_defaults_json->>'projectMasterEnabled', 'true') <> 'false'
        AND NOT EXISTS (SELECT 1 FROM task_runs tr WHERE tr.task_id = m.id AND tr.ended_at IS NULL)
      GROUP BY r.master_task_id
     HAVING MAX(r.created_at) <= now() - make_interval(secs => $1)
         OR MIN(r.created_at) <= now() - make_interval(secs => $2)
      LIMIT 50`,
    [REPORT_QUIET_SECONDS, REPORT_MAX_DELAY_SECONDS]
  );
  for (const candidate of candidates.rows) {
    await wakeMaster(candidate.master_task_id).catch((error) => {
      console.error(`Failed to wake Project Master ${candidate.master_task_id}`, error);
    });
  }
}

export function startProjectMasterWakeLoop(): { stop: () => Promise<void> } {
  let pending: Promise<void> | null = null;
  const run = () => {
    pending ??= wakeProjectMastersOnce().catch((error) => console.error("Project Master wake failed", error))
      .finally(() => { pending = null; });
  };
  const timer = setInterval(run, WAKE_INTERVAL_MS);
  run();
  return { stop: async () => { clearInterval(timer); await pending; } };
}
