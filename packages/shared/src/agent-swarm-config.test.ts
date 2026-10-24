import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS,
  DEFAULT_AGENT_SWARM_SPAWN_EFFORT,
  normalizeAgentSwarmSettings,
  resolveAgentSwarmSpawnLimits
} from "./agent-swarm-config.js";

describe("Agent Swarm spawn effort", () => {
  it("defaults to balanced and preserves current limits", () => {
    const settings = normalizeAgentSwarmSettings({});

    expect(settings.spawnEffort).toBe(DEFAULT_AGENT_SWARM_SPAWN_EFFORT);
    expect(resolveAgentSwarmSpawnLimits(settings)).toEqual({
      maxLanesPerParent: 8,
      maxDepth: 2,
      reconNudgeSteps: 12
    });
  });

  it("scales delegation limits without changing the advanced baseline", () => {
    const settings = normalizeAgentSwarmSettings({
      spawnEffort: 5,
      advanced: { ...DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS }
    });

    expect(resolveAgentSwarmSpawnLimits(settings)).toEqual({
      maxLanesPerParent: 12,
      maxDepth: 3,
      reconNudgeSteps: 6
    });
    expect(settings.advanced).toEqual(DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS);
  });

  it("makes the low profile shallower and slower to split", () => {
    const settings = normalizeAgentSwarmSettings({ spawnEffort: 2 });

    expect(resolveAgentSwarmSpawnLimits(settings)).toEqual({
      maxLanesPerParent: 6,
      maxDepth: 1,
      reconNudgeSteps: 18
    });
  });

  it("keeps an explicitly disabled recon nudge disabled", () => {
    const settings = normalizeAgentSwarmSettings({ spawnEffort: 5, advanced: { reconNudgeSteps: 0 } });

    expect(resolveAgentSwarmSpawnLimits(settings).reconNudgeSteps).toBe(0);
  });
});
