import type { AgentExecutionContext } from "../agent/execution-types.js";
import { appendRunInboxItems } from "../agent/run-inbox.js";
import type { SwarmRunContext } from "./config.js";
import { claimLaneNotesInTx } from "./notes-store.js";
import { buildNotesBlock } from "./prompt.js";

// Before each model request, new notes in the lane's scope are appended as one block at the end of
// its conversation, so its cached prefix is never disturbed. Nothing is appended when nothing is new.
// Check lanes work from the deliverable alone and receive no notes.
export async function appendSwarmNotes(execution: AgentExecutionContext, swarm: SwarmRunContext | null): Promise<void> {
  const lane = swarm?.lane;
  if (!lane || lane.kind === "check") return;
  await appendRunInboxItems(execution, async (client) => {
    const notes = await claimLaneNotesInTx(client, lane, swarm.ancestorLaneIds);
    return notes.length > 0 ? [{ role: "user", content: buildNotesBlock(notes) }] : [];
  });
}
