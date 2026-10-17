import type { PoolClient } from "pg";

// Returns what cancelled nodes have not spent (their pools and reserves) to the parent's pool, and
// stops their members, including any of them that also work in the parent node.
export async function reclaimCancelledSwarmBudgetInTx(
  client: PoolClient,
  input: { workflowTaskId: string; parentNodeId: string; cancelledNodeIds: string[] }
): Promise<number> {
  const nodes = await client.query<{ unassigned_tokens: string | number; system_reserve_tokens: string | number }>(
    `SELECT unassigned_tokens, system_reserve_tokens
       FROM task_workflow_swarm_nodes
      WHERE id = ANY($1::uuid[])
      ORDER BY depth, id FOR UPDATE`,
    [input.cancelledNodeIds]
  );
  const released = nodes.rows.reduce((sum, node) => sum + Number(node.unassigned_tokens) + Number(node.system_reserve_tokens), 0);
  await client.query(
    `UPDATE task_workflow_swarm_nodes
        SET unassigned_tokens = 0, system_reserve_tokens = 0, updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [input.cancelledNodeIds]
  );
  await client.query(
    `UPDATE task_workflow_swarm_node_members
        SET status = 'cancelled', updated_at = now()
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
