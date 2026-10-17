import { AGENT_SWARM_MINIMUM_INFERENCE_TOKENS } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { numberValue } from "./agent-swarm-budget.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import { formatSwarmAgentLabel } from "./shared.js";
import { hasAgentSwarmBudget, resolveSwarmTarget, type SwarmTarget } from "./swarm-target.js";

// A leader whose node's pool is spent cannot get stopped workers back, so an open-ended wait would
// stall the swarm. It may still wait on named workers that are finishing a step.
export async function assertSwarmBudgetAllowsWaiting(context: LoadedWorkflowRunContext, input: {
  targetSwarm?: SwarmTarget;
  waitingForTaskIds?: string[] | null;
}): Promise<void> {
  if (!hasAgentSwarmBudget(context) || (input.waitingForTaskIds?.length ?? 0) > 0) return;
  const target = resolveSwarmTarget(context, input.targetSwarm);
  if (!target.isLeader || !target.nodeId) return;
  const result = await query<{
    unassigned_tokens: string | number;
    is_root: boolean;
    task_id: string;
    slot_index: number | null;
    step_tokens: string | number | null;
  }>(
    `SELECT node.unassigned_tokens, node.parent_node_id IS NULL AS is_root, agent.task_id, agent.slot_index,
            (SELECT weighted_tokens FROM user_token_usage_events usage
              WHERE usage.task_id = agent.task_id
              ORDER BY usage.occurred_at DESC, usage.created_at DESC LIMIT 1) AS step_tokens
       FROM task_workflow_swarm_nodes node
       JOIN task_workflow_swarm_node_members member ON member.node_id = node.id
       JOIN task_workflow_agents agent ON agent.id = member.workflow_agent_id
      WHERE node.workflow_task_id = $1 AND node.node_key = $2
        AND member.role = 'worker' AND member.status = 'paused'`,
    [context.workflowTaskId, target.nodeId]
  );
  if (result.rows.length === 0) return;
  const step = Math.max(AGENT_SWARM_MINIMUM_INFERENCE_TOKENS, ...result.rows.map((row) => numberValue(row.step_tokens)));
  if (numberValue(result.rows[0].unassigned_tokens) >= step) return;
  const labels = result.rows.map((row) => formatSwarmAgentLabel("worker", row.slot_index, row.task_id)).join(", ");
  const deliver = result.rows[0].is_root ? "final_response" : "submit_swarm_output";
  throw new Error([
    `Your node's shared budget is spent and ${labels} stopped, so an open-ended wait would stall the swarm.`,
    `Deliver with what you have now using ${deliver}. To wait for a worker that is still finishing a step, name it in wait_for_task_ids.`
  ].join(" "));
}
