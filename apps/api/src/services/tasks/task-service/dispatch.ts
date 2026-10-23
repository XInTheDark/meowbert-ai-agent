import type { PoolClient } from "pg";
import type { TaskWorkflowType, TaskExecutionJob } from "@meowbert/shared";
import { assertNotLegacyAgentSwarmTaskInTx } from "../../agent-swarm/legacy.js";

class AgentSwarmLaneMessageError extends Error {
  readonly statusCode = 409;

  constructor() {
    super("Lanes take direction from their leader. Send your message to the swarm task instead.");
  }
}

export async function decideTaskDispatchModeInTx(
  client: PoolClient,
  taskId: string,
  options: {
    interruptQueued?: boolean;
  } = {}
): Promise<"interrupting" | "enqueued"> {
  const taskRes = await client.query<{ status: string }>(
    `SELECT status
       FROM tasks
      WHERE id = $1
      FOR UPDATE`,
    [taskId]
  );

  if ((taskRes.rowCount ?? 0) === 0) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const status = taskRes.rows[0].status;
  const wantsInterrupt =
    status === "starting"
    || status === "running"
    || (options.interruptQueued === true && status === "queued");

  if (wantsInterrupt) {
    const runRes = await client.query<{ id: string }>(
      `SELECT id
         FROM task_runs
        WHERE task_id = $1
          AND ended_at IS NULL
        ORDER BY attempt_no DESC
        LIMIT 1`,
      [taskId]
    );

    if ((runRes.rowCount ?? 0) === 0) {
      return "enqueued";
    }

    await client.query(
      `UPDATE tasks
          SET cancellation_requested = true,
              resume_after_interrupt = true,
              updated_at = now()
        WHERE id = $1`,
      [taskId]
    );
    return "interrupting";
  }

  return "enqueued";
}

export async function resolveUserTriggeredRunModeInTx(
  client: PoolClient,
  taskId: string
): Promise<NonNullable<TaskExecutionJob["mode"]>> {
  const taskRes = await client.query<{
    workflow_type: TaskWorkflowType | null;
    workflow_internal_role: "reviewer" | "leader" | "worker" | "lane" | null;
    workflow_parent_task_id: string | null;
    status: string;
  }>(
    `SELECT t.workflow_type,
            t.workflow_internal_role,
            t.workflow_parent_task_id,
            t.status
       FROM tasks t
      WHERE t.id = $1
      FOR UPDATE OF t`,
    [taskId]
  );

  const task = taskRes.rows[0] ?? null;
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (task.workflow_type === "agent_swarm") {
    await assertNotLegacyAgentSwarmTaskInTx(client, taskId);
    if (task.workflow_internal_role === "lane") {
      throw new AgentSwarmLaneMessageError();
    }
    return "agent_swarm_leader";
  }

  let workflowPhase: string | null = null;
  if (task.workflow_type) {
    const workflowRes = await client.query<{
      phase: string;
      state_json: Record<string, unknown> | null;
      config_json: Record<string, unknown> | null;
    }>(
      `SELECT phase, state_json, config_json
         FROM task_workflows
        WHERE task_id = $1
        FOR UPDATE`,
      [task.workflow_parent_task_id ?? taskId]
    );

    workflowPhase = workflowRes.rows[0]?.phase ?? null;
    const reviewMode = workflowRes.rows[0]?.config_json?.reviewMode;

    if (task.workflow_type === "long_horizon" && task.workflow_internal_role === "reviewer") {
      return reviewMode === "quality_control" ? "quality_control_reviewer" : "long_horizon_reviewer";
    }
  }

  if (task.workflow_type === "long_horizon") {
    if (workflowPhase === "clarify") {
      return "long_horizon_clarify";
    }

    return "long_horizon_main";
  }

  const scheduleRes = await client.query<{ mode: "scheduled" | "infinite"; run_timeout_seconds: number | null }>(
    `SELECT mode, run_timeout_seconds
       FROM task_schedules
       WHERE task_id = $1
       FOR UPDATE`,
    [taskId]
  );

  if ((scheduleRes.rowCount ?? 0) === 0) {
    return "default";
  }

  if (scheduleRes.rows[0].mode === "infinite" && (scheduleRes.rows[0].run_timeout_seconds ?? 0) > 0) {
    await client.query(
      `UPDATE task_schedules
          SET schedule_state = 'active',
              next_run_at = NULL,
              pending_run = false,
              run_deadline_at = now() + make_interval(secs => run_timeout_seconds),
              cancelled_at = NULL,
              updated_at = now()
        WHERE task_id = $1`,
      [taskId]
    );
    return "infinite_auto";
  }

  if (scheduleRes.rows[0].mode === "infinite") {
    await client.query(
      `UPDATE task_schedules
          SET schedule_state = 'paused',
              next_run_at = NULL,
              pending_run = false,
              updated_at = now()
        WHERE task_id = $1`,
      [taskId]
    );
    return "infinite_checkin";
  }

  return "default";
}
