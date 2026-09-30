import {
  AGENT_SWARM_MAX_REVIEW_ROUNDS,
  AGENT_SWARM_MAX_WORKERS,
  AGENT_SWARM_MIN_WORKERS,
  type AgentSwarmAgentAllocation
} from "@meowbert/shared/agent-swarm";

export interface SwarmModelOption {
  id: string;
  name: string;
}

export type SwarmSeat =
  | { kind: "model"; agentId: string }
  | { kind: "swarm"; swarm: SwarmDraft };

export interface SwarmDraft {
  key: string;
  id: string;
  name: string;
  description: string;
  reviewRounds: number;
  spawnableAsNode: boolean;
  leader: SwarmSeat | null;
  workers: SwarmSeat[];
}

export interface GeneratedSwarmPreset {
  id: string;
  name: string;
  description: string;
  requiresSuperAdmin: boolean;
  payload: Record<string, never>;
  mode: "agent_swarm";
  leaderAgentId: string;
  modelAllocations: AgentSwarmAgentAllocation[];
  reviewRounds: number;
  spawnableAsNode: boolean;
}

export function parseSwarmModelOptions(raw: string): SwarmModelOption[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const record = entry as Record<string, unknown>;
      if (record.mode === "agent_swarm" || typeof record.id !== "string") return [];
      const id = record.id.trim();
      if (!id) return [];
      return [{ id, name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : id }];
    });
  } catch {
    return [];
  }
}

export function createSwarmDraft(key: string, index = 1): SwarmDraft {
  return {
    key,
    id: `agent-swarm-${index}`,
    name: `Agent Swarm ${index}`,
    description: `Generated Agent Swarm ${index}.`,
    reviewRounds: 0,
    spawnableAsNode: false,
    leader: null,
    workers: []
  };
}

function seatAgentId(seat: SwarmSeat): string {
  return seat.kind === "model" ? seat.agentId : seat.swarm.id.trim().toLowerCase();
}

function collectSwarmPresets(node: SwarmDraft, output: GeneratedSwarmPreset[]): void {
  const nestedSeats = [node.leader, ...node.workers].filter(
    (seat): seat is { kind: "swarm"; swarm: SwarmDraft } => seat?.kind === "swarm"
  );
  for (const seat of nestedSeats) {
    collectSwarmPresets(seat.swarm, output);
  }

  if (!node.leader) {
    throw new Error(`${node.name || "Swarm"} needs a leader.`);
  }
  const workerCounts = new Map<string, number>();
  for (const worker of node.workers) {
    const agentId = seatAgentId(worker);
    if (!agentId) throw new Error(`${node.name || "Swarm"} has a worker without an ID.`);
    workerCounts.set(agentId, (workerCounts.get(agentId) ?? 0) + 1);
  }
  const modelAllocations = Array.from(workerCounts, ([agentId, workerCount]) => ({ agentId, workerCount }));
  const workerCount = modelAllocations.reduce((total, item) => total + item.workerCount, 0);
  if (workerCount < AGENT_SWARM_MIN_WORKERS) {
    throw new Error(`${node.name || "Swarm"} needs at least ${AGENT_SWARM_MIN_WORKERS} workers.`);
  }
  if (workerCount > AGENT_SWARM_MAX_WORKERS) {
    throw new Error(`${node.name || "Swarm"} can have at most ${AGENT_SWARM_MAX_WORKERS} workers.`);
  }
  const id = node.id.trim().toLowerCase();
  if (!id) throw new Error("Every swarm needs an ID.");
  const name = node.name.trim() || id;
  const description = node.description.trim() || `Generated ${name}.`;
  if (id.length > 240 || name.length > 240 || description.length > 240) {
    throw new Error("Swarm IDs, names, and descriptions must be 240 characters or less.");
  }
  if (output.some((preset) => preset.id === id)) {
    throw new Error(`Swarm ID ${id} is used more than once.`);
  }

  output.push({
    id,
    name,
    description,
    requiresSuperAdmin: false,
    payload: {},
    mode: "agent_swarm",
    leaderAgentId: seatAgentId(node.leader),
    modelAllocations,
    reviewRounds: Math.max(0, Math.min(AGENT_SWARM_MAX_REVIEW_ROUNDS, Math.floor(node.reviewRounds))),
    spawnableAsNode: node.spawnableAsNode && nestedSeats.length === 0
  });
}

export function generateSwarmPresets(root: SwarmDraft): GeneratedSwarmPreset[] {
  const output: GeneratedSwarmPreset[] = [];
  collectSwarmPresets(root, output);
  return output;
}

function validateSwarmMemberships(node: SwarmDraft, depth: number): number {
  if (depth > 3) throw new Error("Agent Swarms can be nested at most 3 levels deep.");
  for (const worker of node.workers) {
    if (worker.kind !== "swarm") continue;
    const childLeaderMemberships = validateSwarmMemberships(worker.swarm, depth + 1);
    if (childLeaderMemberships + 1 > 2) {
      throw new Error("A leader model can belong to at most two swarms.");
    }
  }
  const leaderMemberships = node.leader?.kind === "swarm"
    ? validateSwarmMemberships(node.leader.swarm, depth + 1) + 1
    : 1;
  if (leaderMemberships > 2) throw new Error("A leader model can belong to at most two swarms.");
  return leaderMemberships;
}

export function validateGeneratedSwarmPresets(
  root: SwarmDraft,
  models: SwarmModelOption[],
  reservedIds: string[]
): GeneratedSwarmPreset[] {
  const presets = generateSwarmPresets(root);
  const modelIds = new Set(models.map((model) => model.id));
  for (const preset of presets) {
    if (reservedIds.some((id) => id.trim().toLowerCase() === preset.id)) {
      throw new Error(`Preset ID ${preset.id} already exists.`);
    }
    if (!modelIds.has(preset.leaderAgentId) && !presets.some((entry) => entry.id === preset.leaderAgentId)) {
      throw new Error(`${preset.name} needs a valid leader model.`);
    }
    for (const allocation of preset.modelAllocations) {
      if (!modelIds.has(allocation.agentId) && !presets.some((entry) => entry.id === allocation.agentId)) {
        throw new Error(`${preset.name} has an unknown worker model.`);
      }
    }
  }
  if (reservedIds.length + presets.length > 100) {
    throw new Error("Agent presets can contain at most 100 entries.");
  }
  validateSwarmMemberships(root, 1);
  return presets;
}
