import type { TaskExecutionJob } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { enqueueSubagentRun } from "./dispatch.js";
import type { SubagentWait } from "./types.js";

export async function parkForSubagentMail(job: TaskExecutionJob, deadline: string): Promise<void> {
  await withTransaction(async (client) => {
    const task = await client.query<{ cancellation_requested: boolean }>(
      "SELECT cancellation_requested FROM tasks WHERE id = $1 FOR UPDATE", [job.taskId]
    );
    if (task.rows[0]?.cancellation_requested) throw new Error("TASK_CANCELLED");
    await client.query(
      `INSERT INTO task_subagent_waits(task_id, run_id, resume_job_json, deadline_at)
       VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (task_id) DO UPDATE SET
       run_id = EXCLUDED.run_id, resume_job_json = EXCLUDED.resume_job_json, deadline_at = EXCLUDED.deadline_at`,
      [job.taskId, job.runId, JSON.stringify(job), deadline]
    );
    await client.query("UPDATE task_runs SET ended_at = now(), exit_reason = 'subagent_wait' WHERE id = $1", [job.runId]);
    await client.query(
      "UPDATE task_run_dispatches SET queue_state = 'finished', finished_at = now() WHERE run_id = $1", [job.runId]
    );
    await client.query("UPDATE tasks SET status = 'queued', updated_at = now() WHERE id = $1", [job.taskId]);
  });
}

async function wakeTask(taskId: string): Promise<void> {
  await withTransaction(async (client) => {
    const taskRes = await client.query<{
      workspace_id: string; environment_id: string; initiator_user_id: string | null; status: string;
    }>("SELECT workspace_id, environment_id, initiator_user_id, status FROM tasks WHERE id = $1 FOR UPDATE", [taskId]);
    const task = taskRes.rows[0];
    if (!task) return;
    const open = await client.query("SELECT id FROM task_runs WHERE task_id = $1 AND ended_at IS NULL LIMIT 1", [taskId]);
    if (open.rowCount) return;
    const wait = (await client.query<SubagentWait>("SELECT * FROM task_subagent_waits WHERE task_id = $1", [taskId])).rows[0];
    const mail = await client.query<{ id: string }>(
      `SELECT id FROM task_subagent_mail WHERE recipient_task_id = $1 AND delivered_at IS NULL
       AND ($2::boolean OR wake) LIMIT 1`, [taskId, Boolean(wait)]
    );
    const expired = wait && new Date(wait.deadline_at).getTime() <= Date.now();
    if (!mail.rowCount && !expired) return;
    if (expired && !mail.rowCount) await client.query(
      `INSERT INTO task_subagent_mail(recipient_task_id, kind, body, delivery_key)
       VALUES ($1, 'timeout', 'The subagent wait timed out. Subagents have not been cancelled.', $2)
       ON CONFLICT (delivery_key) DO NOTHING`, [taskId, `timeout:${wait.run_id}`]
    );
    const job = wait?.resume_job_json ?? {
      taskId, workspaceId: task.workspace_id, environmentId: task.environment_id,
      triggerSource: "web" as const, mode: "default" as const, selectionUserId: task.initiator_user_id ?? undefined
    };
    // Resolve the latest branch on startup, including messages persisted before parking.
    await enqueueSubagentRun(client, { ...job, branchMessageId: undefined });
    await client.query("DELETE FROM task_subagent_waits WHERE task_id = $1", [taskId]);
  });
}

export async function wakeSubagentsOnce(): Promise<void> {
  const candidates = await query<{ id: string }>(
    `SELECT t.id FROM tasks t
     LEFT JOIN task_subagent_sessions s ON s.task_id = t.id
     JOIN tasks root ON root.id = COALESCE(s.root_task_id, t.id)
     LEFT JOIN task_subagent_waits w ON w.task_id = t.id
     WHERE root.status NOT IN ('succeeded', 'failed', 'cancelled') AND NOT root.cancellation_requested
       AND t.trashed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.task_id = t.id AND r.ended_at IS NULL)
       AND (w.deadline_at <= now() OR EXISTS (
         SELECT 1 FROM task_subagent_mail m WHERE m.recipient_task_id = t.id AND m.delivered_at IS NULL
           AND (w.task_id IS NOT NULL OR m.wake)))
     ORDER BY t.updated_at, t.id LIMIT 100`
  );
  for (const task of candidates.rows) await wakeTask(task.id);
}

export function startSubagentWakeLoop(): { stop: () => Promise<void> } {
  let pending: Promise<void> | null = null;
  const run = () => {
    pending ??= wakeSubagentsOnce().catch((error) => console.error("Subagent wake failed", error))
      .finally(() => { pending = null; });
  };
  const timer = setInterval(run, 2_000);
  run();
  return { stop: async () => { clearInterval(timer); await pending; } };
}
