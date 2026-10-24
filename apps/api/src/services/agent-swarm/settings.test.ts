import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS, type PlatformAgentPreset } from "@meowbert/shared";
import { resolveAgentSwarmSettings } from "./settings.js";

const preset: PlatformAgentPreset = {
  id: "research",
  name: "Research",
  description: "Swarm",
  requiresSuperAdmin: false,
  payload: {},
  mode: "agent_swarm",
  leaderAgentId: "luna",
  routerId: "router-1",
  budgetsEnabled: true,
  tokenBudget: 20_000_000,
  timeBudgetMinutes: 90,
  advanced: { ...DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS, maxDepth: 1, autoCheck: false }
};

describe("resolveAgentSwarmSettings", () => {
  it("uses the preset where the request is silent and the request where it speaks", () => {
    const settings = resolveAgentSwarmSettings(
      { routerId: null, spawnEffort: 5, timeBudgetMinutes: null, advanced: { maxRunningLanes: 4, laneMaxSteps: null } },
      preset
    );

    expect(settings).toEqual({
      leaderAgentId: "luna",
      routerId: null,
      spawnEffort: 5,
      budgetsEnabled: true,
      tokenBudget: 20_000_000,
      timeBudgetMinutes: null,
      advanced: { ...DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS, maxDepth: 1, autoCheck: false, maxRunningLanes: 4 }
    });
  });

  it("falls back to defaults and clamps out-of-range values", () => {
    const settings = resolveAgentSwarmSettings(
      { budgetsEnabled: true, advanced: { maxLanesPerParent: 99, laneWrapUpPercent: 10, laneMaxSteps: 9_000 } },
      null
    );

    expect(settings).toMatchObject({
      leaderAgentId: null,
      routerId: null,
      tokenBudget: 10_000_000,
      advanced: { maxLanesPerParent: 16, laneWrapUpPercent: 50, laneMaxSteps: 500, maxDepth: 2 }
    });
  });

  it("drops budgets when they are switched off", () => {
    const settings = resolveAgentSwarmSettings({ budgetsEnabled: false }, preset);

    expect(settings).toMatchObject({ budgetsEnabled: false, tokenBudget: null, timeBudgetMinutes: null });
  });
});
