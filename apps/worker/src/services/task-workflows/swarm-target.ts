import type { LoadedWorkflowRunContext } from "./context-types.js";
import { asObject } from "./shared.js";

export type SwarmTarget = "outer" | "inner";

export interface ResolvedSwarmTarget {
  nodeId: string | null;
  channelId: string | null;
  leaderTaskId: string;
  workerTaskIds: string[];
  memberTaskIds: string[];
  isLeader: boolean;
}

export function hasDualSwarmRole(context: LoadedWorkflowRunContext): boolean {
  const nodeIds = context.currentAgent?.state_json?.swarmNodeIds;
  const leaderNodeIds = context.currentAgent?.state_json?.swarmLeaderNodeIds;
  return context.workflowType === "agent_swarm"
    && Array.isArray(nodeIds)
    && nodeIds.length === 2
    && Array.isArray(leaderNodeIds)
    && leaderNodeIds.length > 0;
}

// Budgets and dynamic node spawning exist only when the swarm was created with a token budget.
export function hasAgentSwarmBudget(context: LoadedWorkflowRunContext): boolean {
  return context.workflowType === "agent_swarm"
    && typeof context.config.tokenBudget === "number"
    && context.config.tokenBudget > 0;
}

export function hasSwarmLeadership(context: LoadedWorkflowRunContext): boolean {
  if (context.workflowType !== "agent_swarm" || !context.currentAgent) return false;
  const compiled = asObject(context.config.compiledSwarm);
  if (!Array.isArray(compiled.nodes)) return context.currentAgent.role === "leader";
  const leafId = context.currentAgent.state_json?.swarmLeafId;
  if (context.currentAgent.role === "leader" && typeof leafId !== "string") return true;
  return compiled.nodes.map(asObject).some((node) => node.leaderLeafId === leafId);
}

export function resolveSwarmTarget(
  context: LoadedWorkflowRunContext,
  targetSwarm?: SwarmTarget | null
): ResolvedSwarmTarget {
  if (context.workflowType !== "agent_swarm" || !context.currentAgent) {
    throw new Error("Swarm tools are only available to swarm agents.");
  }

  const compiled = asObject(context.config.compiledSwarm);
  const nodes = Array.isArray(compiled.nodes) ? compiled.nodes.map(asObject) : [];
  if (nodes.length === 0) {
    if (targetSwarm) throw new Error("target_swarm is only used by a dual-role swarm leader.");
    const leader = context.agents.find((agent) => agent.role === "leader")
      ?? (context.currentAgent.role === "leader" ? context.currentAgent : null);
    if (!leader) throw new Error("Swarm leader could not be resolved.");
    const workerTaskIds = context.agents.filter((agent) => agent.role === "worker").map((agent) => agent.task_id);
    return {
      nodeId: hasAgentSwarmBudget(context) ? "node-0" : null,
      channelId: context.swarm?.globalChannelId ?? null,
      leaderTaskId: leader.task_id,
      workerTaskIds,
      memberTaskIds: [leader.task_id, ...workerTaskIds],
      isLeader: leader.task_id === context.taskId
    };
  }

  const leafId = context.currentAgent.state_json?.swarmLeafId;
  const memberships = nodes.filter((node) => node.leaderLeafId === leafId
    || (Array.isArray(node.workerLeafIds) && node.workerLeafIds.includes(leafId)));
  if (memberships.length === 0 && context.currentAgent.role === "leader" && typeof leafId !== "string") {
    const rootNodeId = typeof compiled.rootNodeId === "string" ? compiled.rootNodeId : "node-0";
    const workerTaskIds = context.agents
      .filter((agent) => agent.role === "worker" && agent.state_json.swarmParentNodeId == null)
      .map((agent) => agent.task_id);
    return {
      nodeId: rootNodeId,
      channelId: context.swarm?.globalChannelId ?? null,
      leaderTaskId: context.taskId,
      workerTaskIds,
      memberTaskIds: [context.taskId, ...workerTaskIds],
      isLeader: true
    };
  }
  if (memberships.length === 0 || memberships.length > 2) {
    throw new Error("Swarm membership is missing or exceeds two swarms.");
  }
  const dualRole = hasDualSwarmRole(context);
  if (memberships.length === 2 && !dualRole) {
    throw new Error("A non-leader swarm worker cannot target multiple swarms.");
  }
  if (dualRole && !targetSwarm) throw new Error("target_swarm must be outer or inner for this swarm leader.");
  if (!dualRole && targetSwarm) throw new Error("target_swarm is only used by a dual-role swarm leader.");
  const innerNode = dualRole
    ? memberships.find((member) => memberships.some((other) => member.parentNodeId === other.id))
    : null;
  const outerNode = dualRole ? memberships.find((member) => member.id !== innerNode?.id) : null;
  const node = dualRole
    ? targetSwarm === "outer" ? outerNode : innerNode
    : memberships[0];
  if (!node || typeof node.id !== "string") throw new Error("Target swarm could not be resolved.");

  const taskIdByLeafId = new Map(context.agents.flatMap((agent) => {
    const id = agent.state_json?.swarmLeafId;
    return typeof id === "string" ? [[id, agent.task_id] as const] : [];
  }));
  const leaderTaskId = typeof node.leaderLeafId === "string" ? taskIdByLeafId.get(node.leaderLeafId) : null;
  if (!leaderTaskId) throw new Error("Target swarm leader could not be resolved.");
  const workerTaskIds = Array.isArray(node.workerLeafIds)
    ? node.workerLeafIds.flatMap((id) => typeof id === "string" && taskIdByLeafId.has(id)
      ? [taskIdByLeafId.get(id)!] : [])
    : [];
  const channelIds = asObject(context.config.swarmChannelIds);
  const channelId = channelIds[node.id];
  return {
    nodeId: node.id,
    channelId: typeof channelId === "string" ? channelId : null,
    leaderTaskId,
    workerTaskIds,
    memberTaskIds: [leaderTaskId, ...workerTaskIds],
    isLeader: leaderTaskId === context.taskId
  };
}
