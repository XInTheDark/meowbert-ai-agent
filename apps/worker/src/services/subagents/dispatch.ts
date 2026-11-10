import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { normalizeTaskExecutionTarget, type TaskExecutionJob } from "@meowbert/shared";
import { insertTaskRunDispatchWithClient } from "../tasks/task-run-dispatch.js";

// The caller holds the task row lock. Keeping run creation and dispatch together
// lets the existing dispatcher recover a Redis outage without repeating work. The run goes where its
// task runs, so a swarm lane on a device is claimed by that device.
export async function enqueueSubagentRun(client: PoolClient, job: Omit<TaskExecutionJob, "runId">): Promise<string> {
  const runId = randomUUID();
  const task = await client.query<{ execution_target: unknown }>("SELECT execution_target FROM tasks WHERE id = $1", [job.taskId]);
  const executionTarget = normalizeTaskExecutionTarget(task.rows[0]?.execution_target);
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
    payload: { ...job, runId, ...(executionTarget.kind === "local" ? { executionTarget } : {}) }, dispatchCategory: "followup", priorityActorUserId: job.selectionUserId
  });
  return runId;
}
