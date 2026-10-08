import { describe, expect, it } from "vitest";
import { AGENT_SWARM_DEFAULT_TOKEN_BUDGET, type PlatformAgentPreset } from "@meowbert/shared";
import { resolveAgentSwarmTaskSettings } from "./agent-swarm-task-settings.js";

const preset: PlatformAgentPreset = {
  id: "research-swarm",
  name: "Research swarm",
  description: "Swarm",
  requiresSuperAdmin: false,
  payload: {},
  mode: "agent_swarm",
  leaderAgentId: "luna",
  modelAllocations: [{ agentId: "fast", workerCount: 2 }],
  reviewRounds: 1,
  tokenBudget: 20_000_000,
  timeBudgetMinutes: 60
};

describe("resolveAgentSwarmTaskSettings", () => {
  it("uses the preset's roster and budgets when the request only picks the swarm", () => {
    expect(resolveAgentSwarmTaskSettings(undefined, preset)).toEqual({
      usesRequestRoster: false,
      leaderAgentId: "luna",
      modelAllocations: [{ agentId: "fast", workerCount: 2 }],
      reviewRounds: 1,
      tokenBudget: 20_000_000,
      timeBudgetMinutes: 60,
      disableSpawningAndBudgets: false
    });
  });

  it("lets a composer-edited roster and budgets override the preset", () => {
    const settings = resolveAgentSwarmTaskSettings({
      type: "agent_swarm",
      leaderAgentId: "deep",
      modelAllocations: [{ agentId: "fast", workerCount: 4 }],
      reviewRounds: 2,
      tokenBudget: 30_000_000,
      timeBudgetMinutes: null
    }, preset);

    expect(settings).toMatchObject({
      usesRequestRoster: true,
      leaderAgentId: "deep",
      modelAllocations: [{ agentId: "fast", workerCount: 4 }],
      reviewRounds: 2,
      tokenBudget: 30_000_000,
      timeBudgetMinutes: null
    });
  });

  it("clears budgets when spawning and budgets are disabled", () => {
    expect(resolveAgentSwarmTaskSettings(undefined, { ...preset, disableSpawningAndBudgets: true })).toMatchObject({
      tokenBudget: null,
      timeBudgetMinutes: null,
      disableSpawningAndBudgets: true
    });
  });

  it("falls back to the default token budget for a swarm without one", () => {
    expect(resolveAgentSwarmTaskSettings({ type: "agent_swarm", leaderAgentId: "luna" }, null).tokenBudget)
      .toBe(AGENT_SWARM_DEFAULT_TOKEN_BUDGET);
  });
});
