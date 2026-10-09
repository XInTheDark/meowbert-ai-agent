import type { PoolClient } from "pg";
import type { TaskWorkflowType, TaskExecutionJob } from "@meowbert/shared";

async function reactivateAgentSwarmWorkflowCycleInTx(
  client: PoolClient,
  workflowTaskId: string,
  stateJson: Record<string, unknown> | null
): Promise<void> {
  const latestMessageRes = await client.query<{ latest_message_no: number }>(
    `SELECT COALESCE(MAX(message_no), 0)::int AS latest_message_no
       FROM task_workflow_messages
      WHERE workflow_task_id = $1`,
    [workflowTaskId]
  );
  const latestMessageNo = Number(latestMessageRes.rows[0]?.latest_message_no ?? 0) || 0;
  const nextState: Record<string, unknown> = {
    ...(stateJson ?? {}),
    cycleStartMessageNo: latestMessageNo,
    leaderKickoffMessageNo: null,
    workersStartedAt: null,
    startedSwarmWorkerTaskIds: [],
    reviewRounds: [],
    finalReview: null,
    pausedSwarmAgents: {}
  };
  delete nextState.lastSwarmWaitCycleSignature;
  delete nextState.lastSwarmWaitCycleTaskIds;
  delete nextState.lastSwarmStallSignature;
  delete nextState.swarmStall;

  await client.query(
    `UPDATE task_workflows
        SET phase = 'active',
            state_json = $2::jsonb,
            updated_at = now()
      WHERE task_id = $1`,
    [workflowTaskId, JSON.stringify(nextState)]
  );

  await client.query(
    `UPDATE task_runs tr
        SET ended_at = now(),
            exit_reason = COALESCE(exit_reason, 'cancelled')
       FROM tasks t
      WHERE tr.task_id = t.id
        AND tr.ended_at IS NULL
        AND (t.id = $1 OR t.workflow_parent_task_id = $1)`,
    [workflowTaskId]
  );

  await client.query(
    `UPDATE tasks
        SET status = 'awaiting_input',
            cancellation_requested = false,
            resume_after_interrupt = false,
            completed_at = NULL,
            updated_at = now()
      WHERE id = $1
         OR workflow_parent_task_id = $1`,
    [workflowTaskId]
  );
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
    workflow_internal_role: "reviewer" | "leader" | "worker" | null;
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

  let workflowPhase: string | null = null;
  let workflowStateJson: Record<string, unknown> | null = null;
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
    workflowStateJson = workflowRes.rows[0]?.state_json ?? null;
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

  if (task.workflow_type === "agent_swarm") {
    if (workflowPhase === "completed" || (task.status !== "running" && task.status !== "starting" && task.status !== "queued")) {
      await reactivateAgentSwarmWorkflowCycleInTx(
        client,
        task.workflow_parent_task_id ?? taskId,
        workflowStateJson
      );
    }

    return task.workflow_internal_role === "worker"
      ? "agent_swarm_worker"
      : "agent_swarm_leader";
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
