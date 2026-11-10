import { resolveAgentSwarmSpawnLimits } from "@meowbert/shared";
import { appendPromptEnvelopeDelta } from "../agent/prompt-envelope.js";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { formatActivityNotes } from "./activity.js";
import type { SwarmBackend, SwarmRunRef } from "./backend.js";
import { judgeBudget } from "./budget.js";
import { buildLaneWrapUpNote, LANE_STOP_REASON, RECON_NUDGE_NOTE } from "./prompt.js";
import { applyRunInboxAppend } from "./run-inbox.js";

// A leader run that answers a user message, rather than one woken by its lanes.
export function isUserTurnRun(execution: Pick<AgentExecutionContext, "prepared">): boolean {
  const snapshot = execution.prepared.snapshot;
  const leaf = snapshot.messages.find((message) => message.id === snapshot.branch_leaf_message_id);
  return leaf?.role === "user";
}

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

function swarmRun(execution: AgentExecutionContext): SwarmRunRef | null {
  return execution.swarm ? { taskId: execution.job.taskId, swarm: execution.swarm } : null;
}

// Lane results, the leader's view of its lanes at the start of a user turn, notes from siblings and
// messages from the parent, stored and appended in that order. A stop makes the lane's next request
// its forced submit.
async function appendSwarmInbox(execution: AgentExecutionContext, backend: SwarmBackend, run: SwarmRunRef): Promise<void> {
  const state = execution.state;
  const append = await backend.claimInbox(run, {
    includeTurnNotes: !run.swarm.lane && state.stepCount === 0 && isUserTurnRun(execution),
    leafMessageId: state.currentLeafMessageId,
    persistedItems: [...state.dispatchState.runPersistedItems]
  });
  if (!append) return;
  if (append.leafMessageId && append.items.length) await applyRunInboxAppend(execution, { leafMessageId: append.leafMessageId, items: append.items });
  if (append.laneStopped) run.swarm.forcedSubmitReason ??= LANE_STOP_REASON;
}

// A lane at its wrap-up fraction gets one note; at its share, the swarm budget or the deadline it is
// made to submit. The leader is told once per run to deliver. Notes go to the end of the conversation,
// like the step-limit notice, never into the prefix.
async function applySwarmBudget(execution: AgentExecutionContext, backend: SwarmBackend, run: SwarmRunRef): Promise<void> {
  const { swarm } = run;
  if (!swarm.settings.budgetsEnabled || swarm.forcedSubmitReason || swarm.budgetNoteSent) return;
  const state = await backend.loadBudgetState(run);
  if (!state) return;
  const lane = swarm.lane;
  const verdict = judgeBudget(state, {
    isLane: lane !== null,
    isCheck: lane?.kind === "check",
    wrapUpPercent: swarm.settings.advanced.laneWrapUpPercent
  });
  if (verdict.kind === "force") {
    swarm.forcedSubmitReason = verdict.reason;
  } else if (verdict.kind === "wrap_up" && lane) {
    await backend.markWrapUpNotified(run);
    execution.state.dispatchState.conversationItems.push({ role: "user", content: buildLaneWrapUpNote(swarm.settings.advanced.laneWrapUpPercent) });
  } else if (verdict.kind === "leader_note") {
    swarm.budgetNoteSent = true;
    execution.state.dispatchState.conversationItems.push({ role: "user", content: verdict.note });
  }
}

async function maybeAppendReconNudge(execution: AgentExecutionContext, backend: SwarmBackend, run: SwarmRunRef): Promise<void> {
  const reconNudgeSteps = resolveAgentSwarmSpawnLimits(run.swarm.settings).reconNudgeSteps;
  if (run.swarm.lane || execution.state.stepCount !== reconNudgeSteps) return;
  if (!shouldNudgeRecon({
    isLeader: true,
    isUserTurn: isUserTurnRun(execution),
    hasActiveLanes: await backend.hasActiveLanes(run),
    stepCount: execution.state.stepCount,
    reconNudgeSteps
  })) return;
  appendPromptEnvelopeDelta(execution.promptEnvelope, { reason: "swarm-recon-nudge", content: RECON_NUDGE_NOTE });
}

// Everything a swarm run takes in before a model request.
export async function prepareSwarmStep(execution: AgentExecutionContext, backend: SwarmBackend): Promise<void> {
  const run = swarmRun(execution);
  if (!run) return;
  await appendSwarmInbox(execution, backend, run);
  await applySwarmBudget(execution, backend, run);
  await maybeAppendReconNudge(execution, backend, run);
}

// After each model turn: its cost goes to the swarm budget, and a lane records the automatic notes for
// what it did and its live step count. Check lanes report to their parent only, so they write no notes.
export async function afterSwarmModelTurn(execution: AgentExecutionContext, backend: SwarmBackend, weightedTokens: number | null): Promise<void> {
  const run = swarmRun(execution);
  if (!run) return;
  const lane = run.swarm.lane;
  const activity = run.swarm.activity;
  const autoNotes = lane && lane.kind !== "check" ? formatActivityNotes(activity) : [];
  activity.wrote.length = 0;
  activity.searched.length = 0;
  activity.opened.length = 0;
  await backend.recordTurn(run, { weightedTokens, autoNotes });
}
