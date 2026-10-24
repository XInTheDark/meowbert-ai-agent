import { appendPromptEnvelopeDelta } from "../agent/prompt-envelope.js";
import { resolveAgentSwarmSpawnLimits } from "@meowbert/shared";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { RECON_NUDGE_NOTE } from "./prompt.js";
import { isUserTurnRun } from "./turn-notes.js";

// Leaders tend to do everything alone. After `reconNudgeSteps` solo steps in a turn, one note asks
// whether the rest should be split; it is a nudge, not a rule. Interim turns, while lanes still run,
// are not nudged. The prefix is sealed by then, so the note is appended to the conversation.
export function shouldNudgeRecon(input: {
  isLeader: boolean;
  isUserTurn: boolean;
  hasActiveLanes: boolean;
  stepCount: number;
  reconNudgeSteps: number;
}): boolean {
  return input.isLeader && input.isUserTurn && !input.hasActiveLanes
    && input.reconNudgeSteps > 0 && input.stepCount === input.reconNudgeSteps;
}

export async function maybeAppendReconNudge(execution: AgentExecutionContext, hasActiveLanes: () => Promise<boolean>): Promise<void> {
  const swarm = execution.swarm;
  const reconNudgeSteps = swarm ? resolveAgentSwarmSpawnLimits(swarm.settings).reconNudgeSteps : 0;
  if (!swarm || swarm.lane || execution.state.stepCount !== reconNudgeSteps) return;
  if (!shouldNudgeRecon({
    isLeader: true,
    isUserTurn: isUserTurnRun(execution),
    hasActiveLanes: await hasActiveLanes(),
    stepCount: execution.state.stepCount,
    reconNudgeSteps
  })) return;
  appendPromptEnvelopeDelta(execution.promptEnvelope, { reason: "swarm-recon-nudge", content: RECON_NUDGE_NOTE });
}
