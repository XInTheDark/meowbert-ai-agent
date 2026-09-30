import { AGENT_SWARM_MINIMUM_INFERENCE_TOKENS } from "@meowbert/shared";
import type { PoolClient } from "pg";

export async function prepareSwarmWorkerLeaseInTx(client: PoolClient, input: {
  workflowTaskId: string;
  nodeKey: string;
  workerTaskId: string;
}): Promise<void> {
  const quota = await client.query<{
    node_id: string;
    node_status: string;
    member_status: string;
    workflow_agent_id: string;
    lease_tokens: string | number;
    spent_tokens: string | number;
    reserved_tokens: string | number;
    unassigned_tokens: string | number;
  }>(
    `SELECT n.id AS node_id, n.status AS node_status, n.unassigned_tokens,
            m.status AS member_status, m.workflow_agent_id, m.lease_tokens, m.spent_tokens, m.reserved_tokens
       FROM task_workflow_swarm_nodes n
       JOIN task_workflow_swarm_node_members m ON m.node_id = n.id
       JOIN task_workflow_agents a ON a.id = m.workflow_agent_id
      WHERE n.workflow_task_id = $1 AND n.node_key = $2 AND a.task_id = $3
      FOR UPDATE OF n, m`,
    [input.workflowTaskId, input.nodeKey, input.workerTaskId]
  );
  const row = quota.rows[0];
  if (!row) return;
  if (row.node_status !== "active" || row.member_status === "cancelled") {
    throw new Error(`Swarm node or worker is ${row.node_status}; it cannot be resumed.`);
  }
  const child = await client.query<{ id: string; status: string }>(
    `SELECT id, status FROM task_workflow_swarm_nodes
      WHERE parent_node_id = $1 AND leader_task_id = $2
      LIMIT 1`,
    [row.node_id, input.workerTaskId]
  );
  if (child.rows[0]) {
    if (child.rows[0].status === "active") return;
    throw new Error(`Child Swarm node ${child.rows[0].id} is ${child.rows[0].status}. Grant its node budget before resuming its leader.`);
  }
  const recentUsage = await client.query<{ weighted_tokens: string | number | null }>(
    `SELECT weighted_tokens FROM user_token_usage_events
      WHERE task_id = $1 ORDER BY occurred_at DESC, created_at DESC LIMIT 1`,
    [input.workerTaskId]
  );
  const minimumStep = Math.max(AGENT_SWARM_MINIMUM_INFERENCE_TOKENS, Number(recentUsage.rows[0]?.weighted_tokens) || 0);
  const available = Number(row.lease_tokens) - Number(row.spent_tokens) - Number(row.reserved_tokens);
  const shortfall = Math.max(0, minimumStep - available);
  if (shortfall > Number(row.unassigned_tokens)) {
    throw new Error(`Worker lease needs ${shortfall} more weighted tokens for one inference; this node has ${row.unassigned_tokens} unassigned.`);
  }
  if (shortfall > 0) {
    await client.query(
      `UPDATE task_workflow_swarm_nodes
          SET unassigned_tokens = unassigned_tokens - $2, updated_at = now()
        WHERE id = $1`,
      [row.node_id, shortfall]
    );
  }
  await client.query(
    `UPDATE task_workflow_swarm_node_members
        SET lease_tokens = lease_tokens + $3, status = 'active', updated_at = now()
      WHERE node_id = $1 AND workflow_agent_id = $2`,
    [row.node_id, row.workflow_agent_id, shortfall]
  );
}

// Moves any amount the leader chooses from the node's unassigned pool into one worker's lease.
export async function grantSwarmWorkerLeaseInTx(client: PoolClient, input: {
  workflowTaskId: string;
  nodeKey: string;
  workerTaskId: string;
  tokens: number;
}): Promise<void> {
  const quota = await client.query<{
    node_id: string;
    node_status: string;
    member_status: string;
    workflow_agent_id: string;
    unassigned_tokens: string | number;
  }>(
    `SELECT n.id AS node_id, n.status AS node_status, n.unassigned_tokens,
            m.status AS member_status, m.workflow_agent_id
       FROM task_workflow_swarm_nodes n
       JOIN task_workflow_swarm_node_members m ON m.node_id = n.id
       JOIN task_workflow_agents a ON a.id = m.workflow_agent_id
      WHERE n.workflow_task_id = $1 AND n.node_key = $2 AND a.task_id = $3 AND m.role = 'worker'
      FOR UPDATE OF n, m`,
    [input.workflowTaskId, input.nodeKey, input.workerTaskId]
  );
  const row = quota.rows[0];
  if (!row) {
    throw new Error("This agent has no worker budget in your node. Fund a child node with swarm_grant_budget.");
  }
  if (row.node_status !== "active" || row.member_status === "cancelled") {
    throw new Error(`Swarm node or worker is ${row.node_status}; it cannot receive budget.`);
  }
  if (input.tokens > Number(row.unassigned_tokens)) {
    throw new Error(`Cannot grant ${input.tokens} weighted tokens; this node has ${row.unassigned_tokens} unassigned.`);
  }
  await client.query(
    `UPDATE task_workflow_swarm_nodes
        SET unassigned_tokens = unassigned_tokens - $2, updated_at = now()
      WHERE id = $1`,
    [row.node_id, input.tokens]
  );
  await client.query(
    `UPDATE task_workflow_swarm_node_members
        SET lease_tokens = lease_tokens + $3,
            status = CASE WHEN status = 'paused' THEN 'active' ELSE status END,
            updated_at = now()
      WHERE node_id = $1 AND workflow_agent_id = $2`,
    [row.node_id, row.workflow_agent_id, input.tokens]
  );
  await client.query(
    `INSERT INTO task_workflow_swarm_quota_ledger
      (workflow_task_id, node_id, kind, amount_tokens, metadata_json)
     VALUES ($1, $2, 'worker_lease', $3, $4::jsonb)`,
    [input.workflowTaskId, row.node_id, input.tokens, JSON.stringify({ workerTaskId: input.workerTaskId })]
  );
}
