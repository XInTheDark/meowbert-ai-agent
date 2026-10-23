import type { PoolClient } from "pg";
import type { AgentSwarmSettings } from "@meowbert/shared";

// Writes the swarm row that turns a task into an Agent Swarm leader. Re-applying settings to an
// existing swarm replaces its config; spending already recorded is kept.
export async function upsertAgentSwarmInTx(
  client: PoolClient,
  taskId: string,
  settings: AgentSwarmSettings
): Promise<void> {
  const reserveTokens = settings.tokenBudget === null
    ? 0
    : Math.ceil(settings.tokenBudget * settings.advanced.budgetReservePercent / 100);
  await client.query(
    `INSERT INTO task_swarms (task_id, config_json, token_budget, reserve_tokens, deadline_at)
     VALUES ($1, $2::jsonb, $3, $4,
             CASE WHEN $5::integer IS NULL THEN NULL ELSE now() + make_interval(mins => $5::integer) END)
     ON CONFLICT (task_id) DO UPDATE
        SET config_json = EXCLUDED.config_json,
            token_budget = EXCLUDED.token_budget,
            reserve_tokens = EXCLUDED.reserve_tokens,
            deadline_at = EXCLUDED.deadline_at,
            updated_at = now()`,
    [taskId, JSON.stringify(settings), settings.tokenBudget, reserveTokens, settings.timeBudgetMinutes]
  );
}

// Turns an existing standard task into an Agent Swarm leader; its conversation becomes the leader's.
export async function enableAgentSwarmOnTaskInTx(
  client: PoolClient,
  taskId: string,
  settings: AgentSwarmSettings
): Promise<void> {
  await client.query(
    `UPDATE tasks
        SET workflow_type = 'agent_swarm',
            workflow_internal_role = NULL,
            updated_at = now()
      WHERE id = $1`,
    [taskId]
  );
  await upsertAgentSwarmInTx(client, taskId, settings);
}
