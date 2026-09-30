import type { LoadedWorkflowRunContext } from "./context-types.js";
import { resolveSwarmTarget, type SwarmTarget } from "./swarm-target.js";

export function resolveManagedSwarmNode(context: LoadedWorkflowRunContext, targetSwarm?: SwarmTarget | null): {
  workerTaskIds: string[];
} | null {
  if (context.workflowType !== "agent_swarm" || !context.currentAgent) return null;
  const resolved = resolveSwarmTarget(context, targetSwarm);
  return resolved.isLeader ? { workerTaskIds: resolved.workerTaskIds } : null;
}
