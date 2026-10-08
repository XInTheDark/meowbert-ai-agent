import type { AgentSummary } from "../components/tasks/AgentDropdown";
import type { TaskWorkflowComposerConfig } from "../lib/types";
import { mergeSwarmMemberAgents } from "./agentSwarmPresetWorkflow";

// Short top-level roster line, e.g. "Leader: Deep think · 2× Fast · 1× Default". Nested swarms show by name.
export function formatAgentSwarmRosterSummary(
  workflow: TaskWorkflowComposerConfig,
  availableAgents: AgentSummary[],
  selectedAgentId: string | null | undefined
): string | null {
  if (workflow.type !== "agent_swarm" || (!workflow.leaderAgentId && workflow.modelAllocations.length === 0)) {
    return null;
  }
  const agents = mergeSwarmMemberAgents(availableAgents, availableAgents.find((agent) => agent.id === selectedAgentId));
  const nameOf = (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId;
  const parts = [
    ...(workflow.leaderAgentId ? [`Leader: ${nameOf(workflow.leaderAgentId)}`] : []),
    ...workflow.modelAllocations.map((allocation) => `${allocation.workerCount}× ${nameOf(allocation.agentId)}`)
  ];
  return parts.join(" · ");
}
