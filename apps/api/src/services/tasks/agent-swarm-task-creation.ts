import {
  sumAgentSwarmAgentAllocations,
  type AgentSwarmAgentAllocation,
  type CompiledAgentSwarm,
  type PlatformAgentPreset
} from "@meowbert/shared";
import type { AgentSwarmTaskSettings } from "./agent-swarm-task-settings.js";
import { createAgentSwarmWorkflowTask } from "./task-workflows.js";

type SwarmTaskBaseInput = Omit<
  Parameters<typeof createAgentSwarmWorkflowTask>[0],
  "workerCount" | "reviewRounds" | "agentAllocations" | "leaderAgentId" | "compiledSwarm"
  | "tokenBudget" | "timeBudgetMinutes" | "dynamicNodeTypes"
>;

// Starts an Agent Swarm task from resolved swarm settings, for the composer and the Project Master alike.
export function createAgentSwarmTaskFromSettings(base: SwarmTaskBaseInput, input: {
  compiledSwarm: CompiledAgentSwarm | null;
  swarmSettings: AgentSwarmTaskSettings | null;
  agentAllocations: AgentSwarmAgentAllocation[];
  dynamicNodeTypes: PlatformAgentPreset[];
  // Used only without a compiled roster or allocations.
  requestedWorkerCount?: number;
}): ReturnType<typeof createAgentSwarmWorkflowTask> {
  const allocationWorkerCount = sumAgentSwarmAgentAllocations(input.agentAllocations);
  const rootNode = input.compiledSwarm?.nodes.find((node) => node.id === input.compiledSwarm?.rootNodeId) ?? null;
  return createAgentSwarmWorkflowTask({
    ...base,
    workerCount: input.compiledSwarm
      ? Math.max(0, input.compiledSwarm.leaves.length - 1)
      : allocationWorkerCount > 0 ? allocationWorkerCount : input.requestedWorkerCount ?? 2,
    reviewRounds: input.swarmSettings?.reviewRounds ?? rootNode?.reviewRounds ?? 0,
    agentAllocations: input.agentAllocations,
    leaderAgentId: input.swarmSettings?.leaderAgentId ?? null,
    compiledSwarm: input.compiledSwarm ?? undefined,
    tokenBudget: input.swarmSettings?.tokenBudget ?? null,
    timeBudgetMinutes: input.swarmSettings?.timeBudgetMinutes ?? null,
    // Without budgets there is nothing to fund spawned nodes.
    dynamicNodeTypes: input.swarmSettings?.disableSpawningAndBudgets ? [] : input.dynamicNodeTypes
  });
}
