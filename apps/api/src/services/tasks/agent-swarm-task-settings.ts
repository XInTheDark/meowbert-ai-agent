import {
  AGENT_SWARM_DEFAULT_TOKEN_BUDGET,
  type AgentSwarmAgentAllocation,
  type PlatformAgentPreset
} from "@meowbert/shared";

export interface AgentSwarmWorkflowInput {
  type: string;
  reviewRounds?: number | null;
  leaderAgentId?: string | null;
  modelAllocations?: AgentSwarmAgentAllocation[] | null;
  tokenBudget?: number | null;
  timeBudgetMinutes?: number | null;
  disableSpawningAndBudgets?: boolean;
}

export interface AgentSwarmTaskSettings {
  // True when the roster came from the request and still needs its agent references checked.
  usesRequestRoster: boolean;
  leaderAgentId: string | null;
  modelAllocations: AgentSwarmAgentAllocation[];
  reviewRounds: number;
  tokenBudget: number | null;
  timeBudgetMinutes: number | null;
  disableSpawningAndBudgets: boolean;
}

// A swarm preset supplies defaults. A request that names its own leader has edited the roster, and any
// Agent Swarm workflow in the request carries the budgets the user saw in the composer.
export function resolveAgentSwarmTaskSettings(
  workflow: AgentSwarmWorkflowInput | undefined,
  preset: PlatformAgentPreset | null
): AgentSwarmTaskSettings {
  const swarmWorkflow = workflow?.type === "agent_swarm" ? workflow : undefined;
  const usesRequestRoster = !preset || Boolean(swarmWorkflow?.leaderAgentId);
  const roster = usesRequestRoster
    ? {
        leaderAgentId: swarmWorkflow?.leaderAgentId ?? null,
        modelAllocations: swarmWorkflow?.modelAllocations ?? [],
        reviewRounds: swarmWorkflow?.reviewRounds ?? 0
      }
    : {
        leaderAgentId: preset.leaderAgentId ?? null,
        modelAllocations: preset.modelAllocations ?? [],
        reviewRounds: preset.reviewRounds ?? 0
      };
  const budgets: Pick<AgentSwarmWorkflowInput, "tokenBudget" | "timeBudgetMinutes" | "disableSpawningAndBudgets"> =
    swarmWorkflow ?? preset ?? {};
  const disableSpawningAndBudgets = budgets.disableSpawningAndBudgets === true;
  return {
    usesRequestRoster,
    ...roster,
    tokenBudget: disableSpawningAndBudgets ? null : budgets.tokenBudget ?? AGENT_SWARM_DEFAULT_TOKEN_BUDGET,
    timeBudgetMinutes: disableSpawningAndBudgets ? null : budgets.timeBudgetMinutes ?? null,
    disableSpawningAndBudgets
  };
}
