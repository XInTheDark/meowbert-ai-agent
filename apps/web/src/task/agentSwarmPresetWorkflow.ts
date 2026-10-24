import { normalizeAgentSwarmSpawnEffort } from "@meowbert/shared/agent-swarm-config";
import type { AgentSummary } from "../components/tasks/AgentDropdown";
import type { TaskWorkflowComposerConfig } from "../lib/types";
import { buildDefaultTaskWorkflowComposerConfig } from "./taskInputDrafts";

// The composer starts from the swarm preset's own settings; the task request carries them, so a
// later change to the preset never changes a task that already exists.
export function buildSwarmPresetWorkflow(swarm: NonNullable<AgentSummary["swarm"]>): TaskWorkflowComposerConfig {
  return {
    type: "agent_swarm",
    routerId: swarm.routerId,
    spawnEffort: normalizeAgentSwarmSpawnEffort(swarm.spawnEffort),
    budgetsEnabled: swarm.budgetsEnabled,
    tokenBudget: swarm.tokenBudget,
    timeBudgetMinutes: swarm.timeBudgetMinutes,
    advanced: { ...swarm.advanced },
    enableClarifyPhase: true,
    enableReviewPhase: true
  };
}

// Picking a swarm preset turns the draft into that swarm right away; leaving one returns it to a standard task.
export function resolveWorkflowForAgentChange(input: {
  workflow: TaskWorkflowComposerConfig;
  previousAgent: AgentSummary | undefined;
  nextAgent: AgentSummary | undefined;
}): TaskWorkflowComposerConfig {
  if (input.nextAgent?.swarm) {
    return buildSwarmPresetWorkflow(input.nextAgent.swarm);
  }
  if (input.previousAgent?.swarm && input.workflow.type === "agent_swarm") {
    return buildDefaultTaskWorkflowComposerConfig();
  }
  return input.workflow;
}
