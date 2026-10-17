import { withTransaction } from "../../lib/db.js";
import { loadSwarmQuotaMember, type SwarmQuotaMember, type SwarmQuotaReason } from "./agent-swarm-budget.js";
import { wakePausedSwarmAgent } from "./agent-swarm-mailbox.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import { formatSwarmAgentLabel } from "./shared.js";

export type SwarmQuotaNoticeReason = SwarmQuotaReason | "response_quarantined";

function workerStopNotice(context: LoadedWorkflowRunContext, member: SwarmQuotaMember, reason: SwarmQuotaNoticeReason, detail: string): string {
  const agent = context.currentAgent;
  const label = agent ? formatSwarmAgentLabel(agent.role, agent.slot_index, agent.title) : context.taskId;
  if (reason !== "worker_budget_exhausted") return `[Swarm budget] ${label} stopped: ${detail}`;
  const deliver = member.parentLeaderTaskId
    ? "publish your node's result with submit_swarm_output; your parent can grant this node more budget if it needs more"
    : "deliver the answer with final_response";
  return [
    `[Swarm budget] ${label} could not start another step: this node's shared budget is spent, so its workers are stopping.`,
    `Wrap up with what has been reported: ${deliver}. Your own remaining steps use the protected reserve.`
  ].join(" ");
}

function nodeStopNotice(nodeTitle: string, nodeId: string, reason: SwarmQuotaNoticeReason, detail: string): string {
  const subject = `Child node "${nodeTitle}" (${nodeId})`;
  if (reason === "budget_exhausted") {
    return `[Swarm budget] ${subject} has spent its whole budget, including its reserve, and is paused. Grant it more with swarm_grant_budget, cancel it with swarm_cancel_node, or continue with what it has published.`;
  }
  return `[Swarm budget] ${subject} stopped: ${detail}`;
}

// The notice is posted by the system, not by the agent that stopped: it must not read as that agent's
// report. It goes through the channel shared with the leader being woken, never into that leader's
// task history, where an out-of-band message would start a detached branch that drops its context.
async function postSwarmQuotaNotice(context: LoadedWorkflowRunContext, input: {
  member: SwarmQuotaMember;
  reason: SwarmQuotaNoticeReason;
  detail: string;
}): Promise<boolean> {
  const notifyParentNode = input.member.role === "leader";
  return withTransaction(async (client) => {
    const workflow = await client.query<{ phase: string | null; config_json: Record<string, unknown> | null }>(
      `SELECT phase, config_json FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [context.workflowTaskId]
    );
    if (!workflow.rows[0] || workflow.rows[0].phase === "completed") return false;
    const node = await client.query<{ node_key: string; title: string; parent_node_key: string | null }>(
      `SELECT n.node_key, n.title, parent_node.node_key AS parent_node_key
         FROM task_workflow_swarm_nodes n
         LEFT JOIN task_workflow_swarm_nodes parent_node ON parent_node.id = n.parent_node_id
        WHERE n.id = $1`,
      [input.member.nodeId]
    );
    const nodeRow = node.rows[0];
    const channelKey = notifyParentNode ? nodeRow?.parent_node_key : nodeRow?.node_key;
    const channelIds = workflow.rows[0].config_json?.swarmChannelIds;
    const channelId = channelKey && channelIds && typeof channelIds === "object"
      ? (channelIds as Record<string, unknown>)[channelKey]
      : null;
    if (!nodeRow || typeof channelId !== "string") return false;
    const message = notifyParentNode
      ? nodeStopNotice(nodeRow.title, input.member.nodeId, input.reason, input.detail)
      : workerStopNotice(context, input.member, input.reason, input.detail);
    await client.query(
      `INSERT INTO task_workflow_messages (workflow_task_id, channel_id, sender_workflow_agent_id, content_markdown)
       VALUES ($1, $2, NULL, $3)`,
      [context.workflowTaskId, channelId, message]
    );
    return true;
  });
}

// A stopped worker is reported to its node's leader; a stopped node leader to its parent's leader.
export async function wakeParentForSwarmQuota(input: {
  context: LoadedWorkflowRunContext;
  reason: SwarmQuotaNoticeReason;
  detail: string;
}): Promise<void> {
  const member = await loadSwarmQuotaMember(input.context, true);
  const wakeTaskId = member.role === "worker" ? member.nodeLeaderTaskId : member.parentLeaderTaskId;
  if (!wakeTaskId) return;
  const posted = await postSwarmQuotaNotice(input.context, { member, reason: input.reason, detail: input.detail });
  if (!posted) return;
  await wakePausedSwarmAgent(input.context, wakeTaskId, "Swarm leader resumed for a budget event.");
}
