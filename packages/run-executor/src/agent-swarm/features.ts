import type { RunFeatures } from "../agent/ports/run-features.js";
import { isSwarmToolName } from "../agent-tools/swarm.js";
import type { SwarmBackend } from "./backend.js";
import { finalizeSwarmRun, parkLeaderIfLanesActive } from "./finalize.js";
import { prepareLaneRun } from "./lane-run.js";
import { afterSwarmModelTurn, prepareSwarmStep } from "./step.js";
import { interceptFinalResponseForCheck } from "./tools/check.js";
import { handleSwarmTool } from "./tools/index.js";

export type SwarmRunFeatures = Pick<RunFeatures,
  "loadSwarm" | "prepareLaneRun" | "afterModelTurn" | "interceptFinalResponse" | "finalizeSwarmRun" | "parkLeaderIfLanesActive"
> & {
  beforeStep: RunFeatures["beforeStep"];
  handleToolCall: RunFeatures["handleToolCall"];
};

// The Agent Swarm hooks of a run, with swarm state reached through `backend`. The executor code is the
// same in the cloud and on a device; only the backend differs.
export function createSwarmRunFeatures(backend: SwarmBackend): SwarmRunFeatures {
  return {
    loadSwarm: (task, routers) => backend.load(task, routers),
    async prepareLaneRun(input) {
      return prepareLaneRun({ ...input, seed: await backend.loadForkSeed({ taskId: input.taskId, swarm: input.swarm }) });
    },
    beforeStep: (execution) => prepareSwarmStep(execution, backend),
    afterModelTurn: (execution, weightedTokens) => afterSwarmModelTurn(execution, backend, weightedTokens),
    handleToolCall: (call, ctx, state) => isSwarmToolName(call.name) ? handleSwarmTool(backend, call, ctx, state) : null,
    interceptFinalResponse: (call, ctx, state) => interceptFinalResponseForCheck(backend, call, ctx, state),
    finalizeSwarmRun: (execution, appendAssistantMessage) => finalizeSwarmRun(execution, backend, appendAssistantMessage),
    parkLeaderIfLanesActive: (execution) => parkLeaderIfLanesActive(execution, backend)
  };
}
