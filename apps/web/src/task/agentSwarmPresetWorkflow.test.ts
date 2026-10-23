import { DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS } from "@meowbert/shared/agent-swarm-config";
import { describe, expect, it } from "vitest";
import type { AgentSummary } from "../components/tasks/AgentDropdown";
import { resolveWorkflowForAgentChange } from "./agentSwarmPresetWorkflow";
import { buildDefaultTaskWorkflowComposerConfig } from "./taskInputDrafts";

const swarmAgent: AgentSummary = {
  id: "research-swarm",
  name: "Research swarm",
  description: "Swarm",
  mode: "agent_swarm",
  swarm: {
    leaderAgentId: "luna",
    routerId: "auto",
    budgetsEnabled: true,
    tokenBudget: 20_000_000,
    timeBudgetMinutes: 60,
    advanced: { ...DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS, maxLanesPerParent: 4 }
  }
};
const standardAgent: AgentSummary = { id: "default", name: "Default", description: "Agent", mode: "standard" };

describe("resolveWorkflowForAgentChange", () => {
  it("switches a standard draft to the selected swarm's settings", () => {
    const workflow = resolveWorkflowForAgentChange({
      workflow: buildDefaultTaskWorkflowComposerConfig(),
      previousAgent: standardAgent,
      nextAgent: swarmAgent
    });

    expect(workflow).toMatchObject({
      type: "agent_swarm",
      routerId: "auto",
      budgetsEnabled: true,
      tokenBudget: 20_000_000,
      timeBudgetMinutes: 60,
      advanced: { maxLanesPerParent: 4 }
    });
  });

  it("returns to a standard task when leaving a swarm preset", () => {
    const workflow = resolveWorkflowForAgentChange({
      workflow: { ...buildDefaultTaskWorkflowComposerConfig(), type: "agent_swarm" },
      previousAgent: swarmAgent,
      nextAgent: standardAgent
    });

    expect(workflow.type).toBe("standard");
  });
});
