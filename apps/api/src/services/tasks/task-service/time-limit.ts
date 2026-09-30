import type { PoolClient } from "pg";
import type { TaskWorkflowType } from "@meowbert/shared";

interface TimeLimitScope {
  rootTaskId: string;
  appliesToWorkflow: boolean;
}

async function resolveTimeLimitScopeInTx(client: PoolClient, taskId: string): Promise<TimeLimitScope> {
  const taskRes = await client.query<{
    workflow_type: TaskWorkflowType | null;
    workflow_parent_task_id: string | null;
  }>(
    `SELECT workflow_type, workflow_parent_task_id
       FROM tasks
      WHERE id = $1
      FOR UPDATE`,
    [taskId]
  );

  const task = taskRes.rows[0] ?? null;
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  return {
    rootTaskId: task.workflow_parent_task_id ?? taskId,
    appliesToWorkflow: task.workflow_type !== null || task.workflow_parent_task_id !== null
  };
}

function buildTimeLimitScopeWhere(scope: TimeLimitScope): string {
  return scope.appliesToWorkflow
    ? "id = $1 OR workflow_parent_task_id = $1"
    : "id = $1";
}

async function applyTimeLimitDeadlineInScope(
  client: PoolClient,
  scope: TimeLimitScope,
  messageCreatedAt: string
): Promise<void> {
  await client.query(
    `UPDATE tasks
        SET time_limit_deadline_at = CASE
              WHEN time_limit_seconds IS NOT NULL
              THEN $2::timestamptz + make_interval(secs => time_limit_seconds)
              ELSE NULL
            END,
            updated_at = now()
      WHERE ${buildTimeLimitScopeWhere(scope)}`,
    [scope.rootTaskId, messageCreatedAt]
  );
}

export async function activateTaskTimeLimitInTx(
  client: PoolClient,
  taskId: string,
  messageCreatedAt: string
): Promise<void> {
  const scope = await resolveTimeLimitScopeInTx(client, taskId);
  await applyTimeLimitDeadlineInScope(client, scope, messageCreatedAt);
}

export async function updateTaskTimeLimitConfigInTx(
  client: PoolClient,
  taskId: string,
  timeLimitSeconds: number | null
): Promise<void> {
  const scope = await resolveTimeLimitScopeInTx(client, taskId);
  await client.query(
    `UPDATE tasks
        SET time_limit_seconds = $2,
            time_limit_deadline_at = CASE WHEN $2::int IS NULL THEN NULL ELSE time_limit_deadline_at END,
            updated_at = now()
      WHERE ${buildTimeLimitScopeWhere(scope)}`,
    [scope.rootTaskId, timeLimitSeconds]
  );

  if (timeLimitSeconds === null) {
    return;
  }

  const latestUserRes = await client.query<{ created_at: string }>(
    `SELECT created_at
       FROM task_messages
      WHERE task_id = $1
        AND role = 'user'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [scope.rootTaskId]
  );

  const latestUserMessageCreatedAt = latestUserRes.rows[0]?.created_at ?? null;
  if (!latestUserMessageCreatedAt) {
    await client.query(
      `UPDATE tasks
          SET time_limit_deadline_at = NULL,
              updated_at = now()
        WHERE ${buildTimeLimitScopeWhere(scope)}`,
      [scope.rootTaskId]
    );
    return;
  }

  await applyTimeLimitDeadlineInScope(client, scope, latestUserMessageCreatedAt);
}
