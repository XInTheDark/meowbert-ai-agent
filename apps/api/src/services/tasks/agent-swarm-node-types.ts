import { resolvePlatformAgentPresetMode, type PlatformAgentPreset } from "@meowbert/shared";

export function selectAgentSwarmNodeTypes(presets: PlatformAgentPreset[]): PlatformAgentPreset[] {
  const visible = new Map(presets.map((preset) => [preset.id, preset]));
  const isRegularAgent = (id: string | undefined): boolean => {
    const preset = id ? visible.get(id) : undefined;
    return Boolean(preset && resolvePlatformAgentPresetMode(preset) !== "agent_swarm");
  };
  return presets.filter((preset) => {
    if (preset.spawnableAsNode !== true) {
      return false;
    }
    if (resolvePlatformAgentPresetMode(preset) !== "agent_swarm") {
      return true;
    }
    return isRegularAgent(preset.leaderAgentId)
      && (preset.modelAllocations ?? []).every((allocation) => isRegularAgent(allocation.agentId));
  });
}
