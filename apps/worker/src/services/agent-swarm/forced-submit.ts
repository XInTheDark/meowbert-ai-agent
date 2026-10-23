import type { ModelToolChoice } from "../agent/model.js";
import { SUBMIT_TOOL_NAME } from "../agent-tools/swarm.js";
import type { SwarmLaneResult } from "./lane-store.js";

// A lane always returns something. On its last allowed step, or when the runtime makes it stop (a
// stop from its parent, its budget share, the swarm deadline), the next call is forced to submit;
// the tools array is unchanged, so the cached prefix still holds.
export function resolveLaneToolChoice(input: { step: number; maxRunSteps: number; forced: boolean }): ModelToolChoice {
  return input.forced || isLaneFinalStep(input) ? { type: "function", name: SUBMIT_TOOL_NAME } : "required";
}

export function isLaneFinalStep(input: { step: number; maxRunSteps: number }): boolean {
  return input.step >= input.maxRunSteps - 1;
}

// Step limit per lane run; null inherits the task's own limit.
export function resolveLaneMaxSteps(laneMaxSteps: number | null, taskMaxSteps: number): number {
  return laneMaxSteps === null ? taskMaxSteps : Math.min(laneMaxSteps, taskMaxSteps);
}

// What the parent receives when a lane ends without submitting, so its barrier still completes.
export function buildUnsubmittedLaneResult(reason: string): SwarmLaneResult {
  return { summary: reason, decisions: null, findings: null, files: [] };
}
