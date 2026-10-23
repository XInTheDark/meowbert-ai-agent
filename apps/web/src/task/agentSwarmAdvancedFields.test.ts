import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS } from "@meowbert/shared/agent-swarm-config";
import { formatAgentSwarmAdvancedDraft, parseAgentSwarmAdvancedDraft } from "./agentSwarmAdvancedFields";

describe("Agent Swarm advanced fields", () => {
  it("round-trips the settings, with an empty lane step limit inheriting the task's", () => {
    const draft = formatAgentSwarmAdvancedDraft(DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS);
    expect(draft.laneMaxSteps).toBe("");
    expect(parseAgentSwarmAdvancedDraft(draft)).toEqual({ advanced: DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS, error: null });
  });

  it("rejects values outside a field's range instead of clamping them silently", () => {
    const draft = { ...formatAgentSwarmAdvancedDraft(), maxDepth: "4" };
    expect(parseAgentSwarmAdvancedDraft(draft).error).toMatch(/Lane depth must be a whole number from 1 to 3/);
    expect(parseAgentSwarmAdvancedDraft({ ...formatAgentSwarmAdvancedDraft(), maxLanesPerParent: "" }).error).toMatch(/Lanes per parent/);
  });
});
