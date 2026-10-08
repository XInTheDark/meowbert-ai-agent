import { sumAgentSwarmAgentAllocations } from "@meowbert/shared/agent-swarm";
import type { AgentSummary } from "../components/tasks/AgentDropdown";
import type { TaskWorkflowComposerConfig } from "../lib/types";
import { buildDefaultTaskWorkflowComposerConfig } from "./taskInputDrafts";

export function buildSwarmPresetWorkflow(swarm: NonNullable<AgentSummary["swarm"]>): TaskWorkflowComposerConfig {
  return {
    type: "agent_swarm",
    workerCount: sumAgentSwarmAgentAllocations(swarm.modelAllocations),
    reviewRounds: swarm.reviewRounds,
    leaderAgentId: swarm.leaderAgentId,
    modelAllocations: swarm.modelAllocations.map((allocation) => ({ ...allocation })),
    tokenBudget: swarm.tokenBudget,
    timeBudgetMinutes: swarm.timeBudgetMinutes,
    disableSpawningAndBudgets: swarm.disableSpawningAndBudgets,
    enableClarifyPhase: true,
    enableReviewPhase: true
  };
}

// Picking a swarm preset turns the draft into that swarm right away; leaving one returns it to a standard task.
export function resolveWorkflowForAgentChange(input: {
  workflow: TaskWorkflowComposerConfig;
  previousAgent: AgentSummary | undefined;
  nextAgent: AgentSummary | undefined;
  nextAgentId: string | null;
}): TaskWorkflowComposerConfig {
  const { workflow, nextAgentId } = input;
  if (input.nextAgent?.swarm) {
    return buildSwarmPresetWorkflow(input.nextAgent.swarm);
  }
  if (input.previousAgent?.swarm && workflow.type === "agent_swarm") {
    return buildDefaultTaskWorkflowComposerConfig();
  }
  if (workflow.type === "agent_swarm" && workflow.modelAllocations.length === 0 && nextAgentId) {
    return {
      ...workflow,
      leaderAgentId: workflow.leaderAgentId ?? nextAgentId,
      modelAllocations: workflow.workerCount > 0 ? [{ agentId: nextAgentId, workerCount: workflow.workerCount }] : []
    };
  }
  return workflow;
}

// A selected swarm's members can be hidden from the picker, but the composer still lists them so its
// top-level roster can be shown and edited.
export function mergeSwarmMemberAgents(agents: AgentSummary[], selectedAgent: AgentSummary | undefined): AgentSummary[] {
  const members = selectedAgent?.swarm?.members ?? [];
  const knownIds = new Set(agents.map((agent) => agent.id));
  const missing = members
    .filter((member) => !knownIds.has(member.id))
    .map((member) => ({ id: member.id, name: member.name, description: "", mode: member.mode }));
  return missing.length > 0 ? [...agents, ...missing] : agents;
}
