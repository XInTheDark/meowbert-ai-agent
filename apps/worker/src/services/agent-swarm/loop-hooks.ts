import { pool } from "../../lib/db.js";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { flushAutoNotes } from "./auto-notes.js";
import { appendLaneInbox } from "./lane-inbox.js";
import { countActiveChildrenInTx } from "./lane-store.js";
import { appendSwarmMergeMessage } from "./merge-message.js";
import { appendSwarmNotes } from "./notes-delivery.js";
import { recordLaneStep } from "./outcomes.js";
import { maybeAppendReconNudge } from "./recon-nudge.js";
import { appendSwarmTurnNotes } from "./turn-notes.js";

// Everything a swarm run takes in before a model request, in order: lane results, the leader's view
// of its lanes at the start of a user turn, notes from siblings, messages from the parent, and the
// recon nudge. All of it is appended to the end of the conversation.
export async function prepareSwarmStep(execution: AgentExecutionContext): Promise<void> {
  const swarm = execution.swarm;
  if (!swarm) return;
  await appendSwarmMergeMessage(execution, swarm);
  await appendSwarmTurnNotes(execution, swarm);
  await appendSwarmNotes(execution, swarm);
  await appendLaneInbox(execution, swarm);
  await maybeAppendReconNudge(execution, async () => await countActiveChildrenInTx(pool, execution.job.taskId) > 0);
}

// After each model turn of a lane: the automatic notes for what it did and its live step count.
// Check lanes report to their parent only, so they write no notes.
export async function afterSwarmModelTurn(execution: AgentExecutionContext): Promise<void> {
  const lane = execution.swarm?.lane;
  if (!lane) return;
  if (lane.kind !== "check") await flushAutoNotes(lane, execution.swarm!.activity);
  await recordLaneStep(lane.task_id);
}
