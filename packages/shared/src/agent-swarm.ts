export const AGENT_SWARM_MIN_WORKERS = 0;
export const AGENT_SWARM_MAX_WORKERS = 16;
export const AGENT_SWARM_DEFAULT_WORKERS = 3;
export const AGENT_SWARM_MAX_REVIEW_ROUNDS = 10;

export function clampAgentSwarmReviewRounds(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(AGENT_SWARM_MAX_REVIEW_ROUNDS, Math.max(0, Math.floor(value)));
}

export interface AgentSwarmAgentAllocation {
  agentId: string;
  workerCount: number;
}

function normalizeAgentId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const agentId = value.trim().toLowerCase();
  return agentId.length > 0 ? agentId : null;
}

function normalizeWorkerCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const workerCount = Math.floor(value);
  return workerCount >= 0 ? workerCount : null;
}

export function clampAgentSwarmWorkerCount(value: unknown, fallback = AGENT_SWARM_DEFAULT_WORKERS): number {
  const workerCount = normalizeWorkerCount(value) ?? fallback;
  return Math.min(AGENT_SWARM_MAX_WORKERS, Math.max(AGENT_SWARM_MIN_WORKERS, workerCount));
}

export function normalizeAgentSwarmAgentAllocations(value: unknown): AgentSwarmAgentAllocation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const countsByAgentId = new Map<string, number>();
  const orderedAgentIds: string[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as { agentId?: unknown; workerCount?: unknown };
    const agentId = normalizeAgentId(candidate.agentId);
    const workerCount = normalizeWorkerCount(candidate.workerCount);
    if (!agentId || !workerCount) {
      continue;
    }

    if (!countsByAgentId.has(agentId)) {
      orderedAgentIds.push(agentId);
    }
    countsByAgentId.set(agentId, (countsByAgentId.get(agentId) ?? 0) + workerCount);
  }

  return orderedAgentIds.map((agentId) => ({
    agentId,
    workerCount: countsByAgentId.get(agentId) ?? 0
  })).filter((entry) => entry.workerCount > 0);
}

export function limitAgentSwarmAgentAllocations(
  allocations: AgentSwarmAgentAllocation[],
  maxWorkers = AGENT_SWARM_MAX_WORKERS
): AgentSwarmAgentAllocation[] {
  let remaining = Math.max(0, Math.floor(maxWorkers));
  const limited: AgentSwarmAgentAllocation[] = [];

  for (const allocation of allocations) {
    if (remaining <= 0) {
      break;
    }

    const workerCount = Math.min(remaining, Math.max(0, Math.floor(allocation.workerCount)));
    if (workerCount > 0) {
      limited.push({
        agentId: allocation.agentId,
        workerCount
      });
      remaining -= workerCount;
    }
  }

  return limited;
}

export function sumAgentSwarmAgentAllocations(allocations: AgentSwarmAgentAllocation[]): number {
  return allocations.reduce((total, allocation) => total + allocation.workerCount, 0);
}

export function resolveAgentSwarmAgentIdForWorkerSlot(
  allocations: AgentSwarmAgentAllocation[],
  slotIndex: number
): string | null {
  if (!Number.isInteger(slotIndex) || slotIndex < 0) {
    return null;
  }

  let seenWorkers = 0;
  for (const allocation of allocations) {
    const nextSeenWorkers = seenWorkers + allocation.workerCount;
    if (slotIndex < nextSeenWorkers) {
      return allocation.agentId;
    }
    seenWorkers = nextSeenWorkers;
  }

  return null;
}
