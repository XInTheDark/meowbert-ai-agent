import type { PoolClient } from "pg";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { AgentExecutionContext } from "@meowbert/run-executor/agent/execution-types";
import { appendRunInboxItems } from "../agent/run-inbox.js";
import type { SwarmRunContext } from "./config.js";
import { claimLaneNotesInTx } from "./notes-store.js";
import { buildNotesBlock } from "@meowbert/run-executor/agent-swarm/prompt";

// Before each model request, new notes in the lane's scope are appended as one block at the end of
// its conversation, so its cached prefix is never disturbed. Nothing is appended when nothing is new.
// Check lanes work from the deliverable alone and receive no notes.
export async function claimNoteItemsInTx(client: PoolClient, swarm: SwarmRunContext): Promise<ResponseInputItem[]> {
  const lane = swarm.lane;
  if (!lane || lane.kind === "check") return [];
  const notes = await claimLaneNotesInTx(client, lane, swarm.ancestorLaneIds);
  return notes.length > 0 ? [{ role: "user", content: buildNotesBlock(notes) }] : [];
}

export async function appendSwarmNotes(execution: AgentExecutionContext, swarm: SwarmRunContext | null): Promise<void> {
  if (!swarm?.lane || swarm.lane.kind === "check") return;
  await appendRunInboxItems(execution, (client) => claimNoteItemsInTx(client, swarm));
}
