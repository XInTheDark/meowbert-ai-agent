import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { TaskExecutionJob } from "@meowbert/shared";
import { insertTaskRunDispatchWithClient } from "../tasks/task-run-dispatch.js";

// The caller holds the task row lock. Keeping run creation and dispatch together
// lets the existing dispatcher recover a Redis outage without repeating work.
export async function enqueueSubagentRun(client: PoolClient, job: Omit<TaskExecutionJob, "runId">): Promise<string> {
  const runId = randomUUID();
  await client.query(
    `INSERT INTO task_runs(id, task_id, attempt_no, run_kind)
     SELECT $1, $2, COALESCE(MAX(attempt_no), 0) + 1, $3 FROM task_runs WHERE task_id = $2`,
    [runId, job.taskId, job.mode ?? "default"]
  );
  await client.query(
    `UPDATE tasks SET status = 'queued', cancellation_requested = false, resume_after_interrupt = false,
       completed_at = NULL, updated_at = now() WHERE id = $1`, [job.taskId]
  );
  await insertTaskRunDispatchWithClient(client, {
    runId, taskId: job.taskId, workspaceId: job.workspaceId, environmentId: job.environmentId,
    payload: { ...job, runId }, dispatchCategory: "followup", priorityActorUserId: job.selectionUserId
  });
  return runId;
}
