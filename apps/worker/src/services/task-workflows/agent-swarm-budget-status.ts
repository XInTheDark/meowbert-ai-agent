import {
  calculateAgentSwarmMinimumGrant,
  isAgentSwarmPoolLow,
  AGENT_SWARM_MINIMUM_CHILD_NODE_TOKENS,
  AGENT_SWARM_MINIMUM_INFERENCE_TOKENS
} from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { numberValue } from "./agent-swarm-budget.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import { formatSwarmAgentLabel } from "./shared.js";
import { resolveSwarmTarget, type SwarmTarget } from "./swarm-target.js";

export interface SwarmBudgetChildStatus {
  nodeId: string;
  title: string;
  status: string;
  remainingTokens: number;
  deadlineAt: string | null;
  minimumGrantTokens: number;
}

export interface SwarmBudgetWorkerStatus {
  label: string;
  taskId: string;
  // "out_of_budget" once the shared pool could not fund the worker's next step.
  status: string;
  spentTokens: number;
}

// Only what a leader acts on: the pool its agents share, the reserve kept for wrapping up, how much
// each worker has used, and each direct child node.
export interface SwarmBudgetStatus {
  status: string;
  poolTokens: number;
  protectedReserveTokens: number;
  lowBudget: boolean;
  deadlineAt: string | null;
  minimumSpawnAllocationTokens: number;
  workers: SwarmBudgetWorkerStatus[];
  children: SwarmBudgetChildStatus[];
}

async function loadLatestStepTokens(memberTaskIds: string[]): Promise<number> {
  const result = await query<{ weighted_tokens: string | number | null }>(
    `SELECT weighted_tokens
       FROM user_token_usage_events
      WHERE task_id = ANY($1::uuid[])
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT 1`,
    [memberTaskIds]
  );
  return Math.max(AGENT_SWARM_MINIMUM_INFERENCE_TOKENS, numberValue(result.rows[0]?.weighted_tokens));
}

async function loadWorkerStatuses(nodeId: string): Promise<SwarmBudgetWorkerStatus[]> {
  const result = await query<{
    task_id: string;
    slot_index: number | null;
    title: string | null;
    status: string;
    spent_tokens: string | number;
    reserved_tokens: string | number;
  }>(
    `SELECT agent.task_id, agent.slot_index, task.title, member.status, member.spent_tokens, member.reserved_tokens
       FROM task_workflow_swarm_node_members member
       JOIN task_workflow_agents agent ON agent.id = member.workflow_agent_id
       LEFT JOIN tasks task ON task.id = agent.task_id
      WHERE member.node_id = $1 AND member.role = 'worker'
      ORDER BY member.slot_index`,
    [nodeId]
  );
  return result.rows.map((worker) => ({
    label: formatSwarmAgentLabel("worker", worker.slot_index, worker.title),
    taskId: worker.task_id,
    status: worker.status === "paused" ? "out_of_budget" : worker.status,
    spentTokens: numberValue(worker.spent_tokens) + numberValue(worker.reserved_tokens)
  }));
}

async function loadSwarmBudgetChildren(nodeId: string, minimumStepTokens: number): Promise<SwarmBudgetChildStatus[]> {
  const childrenResult = await query<{
    id: string;
    title: string;
    status: string;
    allocated_tokens: string | number;
    unassigned_tokens: string | number;
    deadline_at: string | null;
    worker_slots: string | number;
  }>(
    `SELECT id, title, status, allocated_tokens, unassigned_tokens, deadline_at,
            (SELECT COUNT(*) FROM task_workflow_swarm_node_members member
              WHERE member.node_id = task_workflow_swarm_nodes.id AND member.role = 'worker') AS worker_slots
       FROM task_workflow_swarm_nodes
      WHERE parent_node_id = $1
      ORDER BY created_at ASC, id ASC`,
    [nodeId]
  );
  return childrenResult.rows.map((child) => ({
    nodeId: child.id,
    title: child.title,
    status: child.status,
    remainingTokens: numberValue(child.unassigned_tokens),
    deadlineAt: child.deadline_at,
    minimumGrantTokens: calculateAgentSwarmMinimumGrant({
      allocatedTokens: numberValue(child.allocated_tokens),
      minimumStepTokens,
      workerSlots: numberValue(child.worker_slots),
      spawning: false
    })
  }));
}

export async function getSwarmBudgetStatus(
  context: LoadedWorkflowRunContext,
  targetSwarm?: SwarmTarget
): Promise<SwarmBudgetStatus> {
  const target = resolveSwarmTarget(context, targetSwarm);
  const legacyStatus: SwarmBudgetStatus = {
    status: "legacy",
    poolTokens: 0,
    protectedReserveTokens: 0,
    lowBudget: false,
    deadlineAt: null,
    minimumSpawnAllocationTokens: AGENT_SWARM_MINIMUM_CHILD_NODE_TOKENS,
    workers: [],
    children: []
  };
  if (!target.nodeId) return legacyStatus;

  const nodeResult = await query<{
    id: string;
    status: string;
    unassigned_tokens: string | number;
    system_reserve_tokens: string | number;
    deadline_at: string | null;
  }>(
    `SELECT id, status, unassigned_tokens, system_reserve_tokens, deadline_at
       FROM task_workflow_swarm_nodes
      WHERE node_key = $1
        AND workflow_task_id = $2`,
    [target.nodeId, context.workflowTaskId]
  );
  const node = nodeResult.rows[0];
  if (!node) return legacyStatus;

  const minimumStepTokens = await loadLatestStepTokens(target.memberTaskIds);
  const workers = await loadWorkerStatuses(node.id);
  const poolTokens = numberValue(node.unassigned_tokens);
  return {
    status: node.status,
    poolTokens,
    protectedReserveTokens: numberValue(node.system_reserve_tokens),
    lowBudget: isAgentSwarmPoolLow({ poolTokens, minimumStepTokens, memberCount: workers.length + 1 }),
    deadlineAt: node.deadline_at,
    minimumSpawnAllocationTokens: AGENT_SWARM_MINIMUM_CHILD_NODE_TOKENS,
    workers,
    children: await loadSwarmBudgetChildren(node.id, minimumStepTokens)
  };
}
