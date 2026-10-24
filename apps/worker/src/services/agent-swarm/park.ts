import type { TaskExecutionJob } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { wakeParentIfBarrierMetInTx } from "./barrier.js";
import { loadLane } from "./lane-store.js";
import type { SwarmParkReason } from "@meowbert/run-executor/agent-swarm/lane-types";
import { lockSwarmInTx, startQueuedLanesInTx } from "./scheduler.js";

// No agent waits on another. A parent that started lanes ends its run here; its resume job is kept
// until the barrier wakes it. Mirrors parkForSubagentMail. If its lanes all finished before it parked,
// the barrier wakes it straight away.
export async function parkSwarmRun(input: {
  job: TaskExecutionJob;
  swarmTaskId: string;
  maxRunningLanes: number;
  reason: SwarmParkReason;
}): Promise<{ wokeImmediately: boolean }> {
  const { job } = input;
  return withTransaction(async (client) => {
    await lockSwarmInTx(client, input.swarmTaskId);
    const task = await client.query<{ cancellation_requested: boolean }>(
      "SELECT cancellation_requested FROM tasks WHERE id = $1 FOR UPDATE", [job.taskId]
    );
    if (task.rows[0]?.cancellation_requested) throw new Error("TASK_CANCELLED");
    await client.query(
      `INSERT INTO task_swarm_parks (task_id, swarm_task_id, run_id, resume_job_json, reason)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (task_id) DO UPDATE SET
         run_id = EXCLUDED.run_id, resume_job_json = EXCLUDED.resume_job_json, reason = EXCLUDED.reason, created_at = now()`,
      [job.taskId, input.swarmTaskId, job.runId, JSON.stringify(job), input.reason]
    );
    await client.query("UPDATE task_runs SET ended_at = now(), exit_reason = 'swarm_wait' WHERE id = $1", [job.runId]);
    await client.query("UPDATE task_run_dispatches SET queue_state = 'finished', finished_at = now() WHERE run_id = $1", [job.runId]);
    await client.query("UPDATE tasks SET status = 'queued', updated_at = now() WHERE id = $1", [job.taskId]);
    if (await loadLane(client, job.taskId)) {
      await client.query("UPDATE task_swarm_lanes SET status = 'waiting', updated_at = now() WHERE task_id = $1", [job.taskId]);
      await startQueuedLanesInTx(client, input.swarmTaskId, input.maxRunningLanes);
    }
    return { wokeImmediately: await wakeParentIfBarrierMetInTx(client, job.taskId) };
  });
}

// A run that starts while its task is parked (a user message to a waiting leader) takes over: the
// barrier never wakes a task with an open run, and the run parks again if lanes are still active.
export async function clearSwarmPark(taskId: string): Promise<void> {
  await query("DELETE FROM task_swarm_parks WHERE task_id = $1", [taskId]);
}
