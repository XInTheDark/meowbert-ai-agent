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
    modelAllocations: [{ agentId: "fast", workerCount: 2 }],
    reviewRounds: 1,
    tokenBudget: 20_000_000,
    timeBudgetMinutes: 60,
    disableSpawningAndBudgets: false,
    members: [{ id: "luna", name: "Luna", mode: "standard" }]
  }
};
const standardAgent: AgentSummary = { id: "default", name: "Default", description: "Agent", mode: "standard" };

describe("resolveWorkflowForAgentChange", () => {
  it("switches a standard draft to the selected swarm's settings", () => {
    const workflow = resolveWorkflowForAgentChange({
      workflow: buildDefaultTaskWorkflowComposerConfig(),
      previousAgent: standardAgent,
      nextAgent: swarmAgent,
      nextAgentId: swarmAgent.id
    });

    expect(workflow).toMatchObject({
      type: "agent_swarm",
      workerCount: 2,
      reviewRounds: 1,
      leaderAgentId: "luna",
      modelAllocations: [{ agentId: "fast", workerCount: 2 }],
      tokenBudget: 20_000_000,
      timeBudgetMinutes: 60
    });
  });

  it("returns to a standard task when leaving a swarm preset", () => {
    const workflow = resolveWorkflowForAgentChange({
      workflow: { ...buildDefaultTaskWorkflowComposerConfig(), type: "agent_swarm" },
      previousAgent: swarmAgent,
      nextAgent: standardAgent,
      nextAgentId: standardAgent.id
    });

    expect(workflow.type).toBe("standard");
  });
});
