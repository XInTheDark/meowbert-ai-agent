import type { PoolClient } from "pg";
import type { CompiledAgentSwarm } from "@meowbert/shared";

export async function insertSeededSwarmQuotaNodesInTx(
  client: PoolClient,
  input: {
    workflowTaskId: string;
    compiledSwarm: CompiledAgentSwarm;
    rootQuotaNodeId: string;
    agentIdsByLeaf: Map<string, string>;
  }
): Promise<void> {
  const inserted = new Map<string, { id: string; depth: number }>([[
    input.compiledSwarm.rootNodeId,
    { id: input.rootQuotaNodeId, depth: 1 }
  ]]);
  const pending = input.compiledSwarm.nodes.filter((node) => node.id !== input.compiledSwarm.rootNodeId);
  while (pending.length > 0) {
    const index = pending.findIndex((node) => node.parentNodeId && inserted.has(node.parentNodeId));
    if (index < 0) throw new Error("Compiled Agent Swarm nodes contain an unresolved parent.");
    const [node] = pending.splice(index, 1);
    const parent = inserted.get(node.parentNodeId!)!;
    const siblings = input.compiledSwarm.nodes.filter((candidate) => candidate.parentNodeId === node.parentNodeId);
    const generation = siblings.findIndex((candidate) => candidate.id === node.id);
    const leaderAgentId = input.agentIdsByLeaf.get(node.leaderLeafId);
    if (!leaderAgentId) throw new Error(`Swarm leader agent missing for ${node.id}.`);
    const insertedNode = await client.query<{ id: string }>(
      `INSERT INTO task_workflow_swarm_nodes (
        workflow_task_id, parent_node_id, node_key, generation, title, depth,
        status, paused_reason, leader_task_id, deadline_at, created_by_workflow_agent_id
      ) SELECT $1, $2, $3, $4, $5, $6,
               'paused', 'budget_exhausted', agent.task_id, parent.deadline_at, $7
          FROM task_workflow_agents agent
          JOIN task_workflow_swarm_nodes parent ON parent.id = $2
         WHERE agent.id = $7
      RETURNING id`,
      [input.workflowTaskId, parent.id, node.id, generation, node.title, parent.depth + 1, leaderAgentId]
    );
    const quotaNodeId = insertedNode.rows[0]?.id;
    if (!quotaNodeId) throw new Error(`Swarm quota node could not be created for ${node.id}.`);
    inserted.set(node.id, { id: quotaNodeId, depth: parent.depth + 1 });
    const members = [node.leaderLeafId, ...node.workerLeafIds];
    for (const [memberIndex, leafId] of members.entries()) {
      const workflowAgentId = input.agentIdsByLeaf.get(leafId);
      if (!workflowAgentId) throw new Error(`Swarm member agent missing for ${leafId}.`);
      await client.query(
        `INSERT INTO task_workflow_swarm_node_members
          (node_id, workflow_agent_id, role, slot_index, status)
         VALUES ($1, $2, $3, $4, 'paused')`,
        [quotaNodeId, workflowAgentId, memberIndex === 0 ? "leader" : "worker", memberIndex === 0 ? 0 : memberIndex - 1]
      );
    }
  }
}
