import { describe, expect, it } from "vitest";
import { parseAgentPresetsDraft } from "./adminSettingsDrafts";

function swarmDraft(fields: Record<string, unknown>): string {
  return JSON.stringify([{
    id: "research-swarm", name: "Research Swarm", description: "Lanes for research",
    requiresSuperAdmin: false, payload: {}, mode: "agent_swarm", leaderAgentId: "luna", ...fields
  }]);
}

describe("agent preset draft", () => {
  it("keeps a swarm preset's router, budgets and advanced lane limits", () => {
    const [preset] = parseAgentPresetsDraft(swarmDraft({
      routerId: "auto", spawnEffort: 5, budgetsEnabled: true, tokenBudget: 2_000_000,
      advanced: { maxLanesPerParent: 4, laneMaxSteps: null, autoCheck: false }
    }));

    expect(preset).toMatchObject({
      routerId: "auto",
      spawnEffort: 5,
      budgetsEnabled: true,
      tokenBudget: 2_000_000,
      advanced: { maxLanesPerParent: 4, laneMaxSteps: null, autoCheck: false, maxDepth: 2 }
    });
  });

  it("rejects swarm fields the API would refuse", () => {
    expect(() => parseAgentPresetsDraft(swarmDraft({ leaderAgentId: undefined }))).toThrow(/leaderAgentId/);
    expect(() => parseAgentPresetsDraft(swarmDraft({ spawnEffort: 6 }))).toThrow(/spawnEffort/);
    expect(() => parseAgentPresetsDraft(swarmDraft({ advanced: { maxDepth: 9 } }))).toThrow(/maxDepth/);
    expect(() => parseAgentPresetsDraft(swarmDraft({ advanced: { workerCount: 3 } }))).toThrow(/unknown advanced field/);
  });
});
