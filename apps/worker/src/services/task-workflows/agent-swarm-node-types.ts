import {
  limitAgentSwarmAgentAllocations,
  normalizeAgentSwarmAgentAllocations,
  resolvePlatformAgentPresetMode,
  type AgentSwarmAgentAllocation,
  type PlatformAgentPreset,
  type PlatformAgentPresetMode
} from "@meowbert/shared";

export interface AgentSwarmNodeType {
  id: string;
  name: string;
  description: string;
  leaderAgentId: string;
  leaderAgentMode: PlatformAgentPresetMode;
  modelAllocations: AgentSwarmAgentAllocation[];
  workerAgentModes: PlatformAgentPresetMode[];
  reviewRounds: number;
}

export function listAgentSwarmNodeTypes(raw: unknown): AgentSwarmNodeType[] {
  if (!Array.isArray(raw)) return [];
  const presets = raw as PlatformAgentPreset[];
  const swarmIds = new Set(presets.flatMap((preset) =>
    resolvePlatformAgentPresetMode(preset) === "agent_swarm" && typeof preset.id === "string" ? [preset.id] : []
  ));
  const presetById = new Map(presets.map((preset) => [preset.id, preset]));
  return presets.flatMap((preset) => {
    if (typeof preset.id !== "string" || preset.spawnableAsNode !== true) return [];
    if (resolvePlatformAgentPresetMode(preset) !== "agent_swarm") {
      return [{
        id: preset.id,
        name: preset.name,
        description: preset.description,
        leaderAgentId: preset.id,
        leaderAgentMode: resolvePlatformAgentPresetMode(preset),
        modelAllocations: [],
        workerAgentModes: [],
        reviewRounds: 0
      }];
    }
    const allocations = limitAgentSwarmAgentAllocations(
      normalizeAgentSwarmAgentAllocations(preset.modelAllocations)
    );
    if (!preset.leaderAgentId || swarmIds.has(preset.leaderAgentId)
      || allocations.some((allocation) => swarmIds.has(allocation.agentId))) return [];
    return [{
      id: preset.id,
      name: preset.name,
      description: preset.description,
      leaderAgentId: preset.leaderAgentId,
      leaderAgentMode: resolvePlatformAgentPresetMode(presetById.get(preset.leaderAgentId)),
      modelAllocations: allocations,
      workerAgentModes: allocations.map((allocation) => resolvePlatformAgentPresetMode(presetById.get(allocation.agentId))),
      reviewRounds: preset.reviewRounds ?? 0
    }];
  });
}
