import { buildTaskRunQueueJobId } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";

const REMOVABLE_PENDING_JOB_STATES = new Set([
  "waiting",
  "delayed",
  "paused",
  "prioritized",
  "waiting-children"
]);

export async function cancelPendingWorkflowRuns(
  workflowTaskId: string,
  keepRunId: string | null
): Promise<void> {
  const runsResult = await query<{ run_id: string; task_id: string }>(
    `WITH RECURSIVE task_scope AS (
       SELECT id
         FROM tasks
        WHERE id = $1
       UNION
       SELECT child.id
         FROM tasks child
         JOIN task_scope parent
           ON child.parent_task_id = parent.id
           OR child.workflow_parent_task_id = parent.id
      )
      SELECT tr.id AS run_id, tr.task_id
        FROM task_runs tr
       WHERE tr.task_id IN (SELECT id FROM task_scope)
         AND tr.ended_at IS NULL
         AND ($2::uuid IS NULL OR tr.id <> $2::uuid)`,
    [workflowTaskId, keepRunId]
  );
  if ((runsResult.rowCount ?? 0) === 0) return;

  const cancelledRunIds: string[] = [];
  for (const row of runsResult.rows) {
    const job = await taskQueue.getJob(buildTaskRunQueueJobId(row.task_id, row.run_id));
    if (!job) {
      cancelledRunIds.push(row.run_id);
      continue;
    }
    if (!REMOVABLE_PENDING_JOB_STATES.has(await job.getState())) continue;
    await job.remove().catch(() => undefined);
    cancelledRunIds.push(row.run_id);
  }
  if (cancelledRunIds.length === 0) return;

  await query(
    `UPDATE task_runs
        SET ended_at = now(),
            exit_reason = 'cancelled'
      WHERE id = ANY($1::uuid[])
        AND ended_at IS NULL`,
    [cancelledRunIds]
  );
}
