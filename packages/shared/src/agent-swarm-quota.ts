export const AGENT_SWARM_MAX_DEPTH = 8;
export const AGENT_SWARM_MAX_ACTIVE_NODES = 256;
export const AGENT_SWARM_MAX_ACTIVE_AGENTS = 256;
export const AGENT_SWARM_DEFAULT_TOKEN_BUDGET = 10_000_000;
export const AGENT_SWARM_SYSTEM_RESERVE_PERCENT = 0.1;
// Share of a node's operating budget its leader may spend on its own work before its workers and
// child nodes have used at least as much.
export const AGENT_SWARM_LEADER_SHARE_PERCENT = 0.2;
// Once a node's pool covers fewer than this many more steps for each of its agents, they are told
// once to report what they have and start wrapping up.
export const AGENT_SWARM_LOW_BUDGET_STEPS_PER_MEMBER = 3;
export const AGENT_SWARM_RECOVERY_STEPS = 2;
export const AGENT_SWARM_MIN_OUTPUT_RESERVATION = 512;
export const AGENT_SWARM_MINIMUM_INFERENCE_TOKENS = 8_192;
export const AGENT_SWARM_RECOMMENDED_STEPS_PER_SLOT = 4;
// A spawned child node needs room for real work, not just a few inference steps.
export const AGENT_SWARM_MINIMUM_CHILD_NODE_TOKENS = 1_000_000;

export type AgentSwarmNodeStatus = "active" | "paused" | "completed" | "cancelled";

export type AgentSwarmQuotaPauseReason =
  | "budget_exhausted"
  | "deadline_reached"
  | "worker_budget_exhausted"
  | "parent_cancelled";

export type AgentSwarmQuotaLedgerKind =
  | "root_grant"
  | "child_grant"
  | "worker_lease"
  | "reservation"
  | "settlement"
  | "reclaim"
  | "recovery"
  | "adjustment";

export interface AgentSwarmResourceQuota {
  allocatedTokens: number;
  spentTokens: number;
  reservedTokens: number;
  systemReserveTokens: number;
  unassignedTokens: number;
  debtTokens: number;
  deadlineAt: string | null;
}

export interface AgentSwarmBudgetEstimate {
  minimumStepTokens: number;
  minimumResumeGrantTokens: number;
  minimumSpawnAllocationTokens: number;
  recommendedSpawnAllocationTokens: number;
}

function finiteInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

export function calculateAgentSwarmSystemReserve(
  allocatedTokens: number,
  minimumRecoveryGrantTokens: number
): number {
  const allocated = finiteInteger(allocatedTokens);
  const minimumRecovery = finiteInteger(minimumRecoveryGrantTokens);
  return Math.max(Math.ceil(allocated * AGENT_SWARM_SYSTEM_RESERVE_PERCENT), minimumRecovery * AGENT_SWARM_RECOVERY_STEPS);
}

export function calculateAgentSwarmBudgetEstimate(input: {
  minimumStepTokens: number;
  workerSlots: number;
}): AgentSwarmBudgetEstimate {
  const minimumStepTokens = Math.max(1, finiteInteger(input.minimumStepTokens, AGENT_SWARM_MIN_OUTPUT_RESERVATION));
  const workerSlots = Math.max(0, finiteInteger(input.workerSlots));
  const slots = workerSlots + 1;
  const minimumResumeGrantTokens = Math.ceil(minimumStepTokens / (1 - AGENT_SWARM_SYSTEM_RESERVE_PERCENT));
  const minimumSpawnAllocationTokens = Math.ceil(
    (slots * minimumStepTokens) / (1 - AGENT_SWARM_SYSTEM_RESERVE_PERCENT)
  );
  return {
    minimumStepTokens,
    minimumResumeGrantTokens,
    minimumSpawnAllocationTokens,
    recommendedSpawnAllocationTokens: minimumSpawnAllocationTokens * AGENT_SWARM_RECOMMENDED_STEPS_PER_SLOT
  };
}

export function calculateAgentSwarmMinimumGrant(input: {
  allocatedTokens: number;
  minimumStepTokens: number;
  workerSlots: number;
  spawning: boolean;
}): number {
  const estimate = calculateAgentSwarmBudgetEstimate({
    minimumStepTokens: input.minimumStepTokens,
    workerSlots: input.workerSlots
  });
  const reserve = calculateAgentSwarmSystemReserve(input.allocatedTokens, estimate.minimumStepTokens);
  return reserve + (input.spawning ? estimate.minimumSpawnAllocationTokens : estimate.minimumResumeGrantTokens);
}

export function isAgentSwarmPoolLow(input: { poolTokens: number; minimumStepTokens: number; memberCount: number }): boolean {
  const stepsLeft = finiteInteger(input.minimumStepTokens) * Math.max(1, finiteInteger(input.memberCount));
  return finiteInteger(input.poolTokens) < stepsLeft * AGENT_SWARM_LOW_BUDGET_STEPS_PER_MEMBER;
}

// How much a node's leader may draw from the shared pool for itself: a fixed share of the operating
// budget, or as much as its workers have spent and its child nodes were granted, whichever is larger.
export function calculateAgentSwarmLeaderAllowance(input: {
  allocatedTokens: number;
  delegatedTokens: number;
}): number {
  const operatingTokens = Math.floor(finiteInteger(input.allocatedTokens) * (1 - AGENT_SWARM_SYSTEM_RESERVE_PERCENT));
  return Math.max(Math.floor(operatingTokens * AGENT_SWARM_LEADER_SHARE_PERCENT), finiteInteger(input.delegatedTokens));
}
