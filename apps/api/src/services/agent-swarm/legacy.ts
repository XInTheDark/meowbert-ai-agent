import type { PoolClient } from "pg";

export const LEGACY_AGENT_SWARM_TASK_MESSAGE =
  "This Agent Swarm task was created with the previous swarm version. Start a new task.";

export class LegacyAgentSwarmTaskError extends Error {
  readonly statusCode = 409;

  constructor() {
    super(LEGACY_AGENT_SWARM_TASK_MESSAGE);
    this.name = "LegacyAgentSwarmTaskError";
  }
}

// SQL for "this task is an Agent Swarm from before lanes": a swarm task whose root has no swarm row.
export function legacyAgentSwarmTaskSql(taskAlias: string): string {
  return `(${taskAlias}.workflow_type = 'agent_swarm'
    AND NOT EXISTS (SELECT 1 FROM task_swarms legacy_swarm
                     WHERE legacy_swarm.task_id = COALESCE(${taskAlias}.workflow_parent_task_id, ${taskAlias}.id)))`;
}

// Old swarm conversations stay readable, but nothing can continue them.
export async function assertNotLegacyAgentSwarmTaskInTx(client: Pick<PoolClient, "query">, taskId: string): Promise<void> {
  const result = await client.query<{ legacy: boolean }>(
    `SELECT ${legacyAgentSwarmTaskSql("t")} AS legacy FROM tasks t WHERE t.id = $1`,
    [taskId]
  );
  if (result.rows[0]?.legacy) {
    throw new LegacyAgentSwarmTaskError();
  }
}
