import { AGENT_SWARM_MINIMUM_INFERENCE_TOKENS } from "@meowbert/shared";
import type { PoolClient } from "pg";

// A worker draws its steps from its node's shared pool, so starting one only needs an active node
// whose pool can fund the worker's next step.
export async function assertSwarmWorkerCanStartInTx(client: PoolClient, input: {
  workflowTaskId: string;
  nodeKey: string;
  workerTaskId: string;
}): Promise<void> {
  const quota = await client.query<{
    node_id: string;
    node_status: string;
    member_status: string;
    unassigned_tokens: string | number;
  }>(
    `SELECT n.id AS node_id, n.status AS node_status, n.unassigned_tokens, m.status AS member_status
       FROM task_workflow_swarm_nodes n
       JOIN task_workflow_swarm_node_members m ON m.node_id = n.id
       JOIN task_workflow_agents a ON a.id = m.workflow_agent_id
      WHERE n.workflow_task_id = $1 AND n.node_key = $2 AND a.task_id = $3`,
    [input.workflowTaskId, input.nodeKey, input.workerTaskId]
  );
  const row = quota.rows[0];
  if (!row) return;
  if (row.node_status !== "active" || row.member_status === "cancelled") {
    throw new Error(`Swarm node or worker is ${row.node_status}; it cannot be resumed.`);
  }
  // A worker that leads its own child node spends from that node instead.
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
  if (Number(row.unassigned_tokens) < minimumStep) {
    throw new Error(`This node's shared budget is spent (${row.unassigned_tokens} weighted tokens left; a step needs ${minimumStep}). Wrap up with what your workers have reported.`);
  }
}
