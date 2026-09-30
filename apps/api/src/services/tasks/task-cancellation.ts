import { withTransaction } from "../../lib/db.js";

// Cancels a task and its schedule; swarm member tasks cancel the whole swarm.
export async function cancelTaskAndSchedules(taskId: string): Promise<void> {
  await withTransaction(async (client) => {
    const workflowRes = await client.query<{
      workflow_type: "long_horizon" | "agent_swarm" | null;
      workflow_parent_task_id: string | null;
    }>(
      `SELECT workflow_type, workflow_parent_task_id
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [taskId]
    );
    const workflow = workflowRes.rows[0] ?? null;
    const swarmRootTaskId = workflow?.workflow_type === "agent_swarm"
      ? (workflow.workflow_parent_task_id ?? taskId)
      : null;
    const targetTaskId = swarmRootTaskId ?? taskId;

    await client.query(
      swarmRootTaskId
        ? `UPDATE tasks
              SET cancellation_requested = true,
                  resume_after_interrupt = false,
                  updated_at = now()
            WHERE id = $1
               OR workflow_parent_task_id = $1`
        : `UPDATE tasks
              SET cancellation_requested = true,
                  resume_after_interrupt = false,
                  updated_at = now()
            WHERE id = $1`,
      [targetTaskId]
    );

    await client.query(
      swarmRootTaskId
        ? `UPDATE task_schedules
              SET schedule_state = 'cancelled',
                  next_run_at = NULL,
                  run_deadline_at = NULL,
                  pending_run = false,
                  cancelled_at = now(),
                  updated_at = now()
            WHERE task_id IN (
              SELECT id
                FROM tasks
               WHERE id = $1
                  OR workflow_parent_task_id = $1
            )`
        : `UPDATE task_schedules
              SET schedule_state = 'cancelled',
                  next_run_at = NULL,
                  run_deadline_at = NULL,
                  pending_run = false,
                  cancelled_at = now(),
                  updated_at = now()
            WHERE task_id = $1`,
      [targetTaskId]
    );
  });
}
