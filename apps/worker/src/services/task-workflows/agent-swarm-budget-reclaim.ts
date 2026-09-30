import type { PoolClient } from "pg";

interface ReclaimableNode {
  unassigned_tokens: string | number;
  system_reserve_tokens: string | number;
}

interface ReclaimableMember {
  node_id: string;
  workflow_agent_id: string;
  lease_tokens: string | number;
  spent_tokens: string | number;
  reserved_tokens: string | number;
}

function unusedLease(member: ReclaimableMember): number {
  return Math.max(0, Number(member.lease_tokens) - Number(member.spent_tokens) - Number(member.reserved_tokens));
}

export async function reclaimCancelledSwarmBudgetInTx(
  client: PoolClient,
  input: { workflowTaskId: string; parentNodeId: string; cancelledNodeIds: string[] }
): Promise<number> {
  const nodes = await client.query<ReclaimableNode>(
    `SELECT unassigned_tokens, system_reserve_tokens
       FROM task_workflow_swarm_nodes
      WHERE id = ANY($1::uuid[])
      ORDER BY depth, id FOR UPDATE`,
    [input.cancelledNodeIds]
  );
  const members = await client.query<ReclaimableMember>(
    `SELECT node_id, workflow_agent_id, lease_tokens, spent_tokens, reserved_tokens
       FROM task_workflow_swarm_node_members
      WHERE node_id = ANY($1::uuid[])
      FOR UPDATE`,
    [input.cancelledNodeIds]
  );
  const outerMembers = await client.query<ReclaimableMember>(
    `SELECT m.node_id, m.workflow_agent_id, m.lease_tokens, m.spent_tokens, m.reserved_tokens
       FROM task_workflow_swarm_node_members m
      WHERE m.node_id = $1
        AND m.workflow_agent_id IN (
          SELECT workflow_agent_id FROM task_workflow_swarm_node_members
           WHERE node_id = ANY($2::uuid[])
        )
      FOR UPDATE`,
    [input.parentNodeId, input.cancelledNodeIds]
  );
  const released = nodes.rows.reduce((sum, node) => sum + Number(node.unassigned_tokens) + Number(node.system_reserve_tokens), 0)
    + [...members.rows, ...outerMembers.rows].reduce((sum, member) => sum + unusedLease(member), 0);
  await client.query(
    `UPDATE task_workflow_swarm_nodes
        SET unassigned_tokens = 0, system_reserve_tokens = 0, updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [input.cancelledNodeIds]
  );
  await client.query(
    `UPDATE task_workflow_swarm_node_members
        SET lease_tokens = spent_tokens + reserved_tokens, status = 'cancelled', updated_at = now()
      WHERE node_id = ANY($1::uuid[])
         OR (node_id = $2 AND workflow_agent_id IN (
           SELECT workflow_agent_id FROM task_workflow_swarm_node_members
            WHERE node_id = ANY($1::uuid[])
         ))`,
    [input.cancelledNodeIds, input.parentNodeId]
  );
  if (released > 0) {
    await client.query(
      `UPDATE task_workflow_swarm_nodes
          SET unassigned_tokens = unassigned_tokens + $2, updated_at = now()
        WHERE id = $1`,
      [input.parentNodeId, released]
    );
    await client.query(
      `INSERT INTO task_workflow_swarm_quota_ledger
        (workflow_task_id, node_id, parent_node_id, kind, amount_tokens)
       VALUES ($1, $2, $3, 'reclaim', $4)`,
      [input.workflowTaskId, input.cancelledNodeIds[0], input.parentNodeId, released]
    );
  }
  return released;
}
