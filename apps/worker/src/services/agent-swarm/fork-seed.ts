import type { PoolClient } from "pg";
import type { FunctionTool, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { query } from "../../lib/db.js";
import type { PromptEnvelope, PromptEnvelopeDelta, PromptEnvelopeFrame } from "../agent/prompt-envelope.js";
import type { TaskMessageToolOptions } from "../agent/types.js";
import type { SubagentRuntime } from "../subagents/types.js";

// A fork is a snapshot of the parent's exact request, so a lane's first request matches the parent's
// last one byte for byte up to the lane's own tool result and reads the parent's cached prefix.

export interface ForkSeedEnvelope {
  baseVersion: string;
  baseFrames: PromptEnvelopeFrame[];
  deltas: PromptEnvelopeDelta[];
}

export interface ForkSeedTools {
  response: Tool[];
  // Tools reachable only through exec when the parent ran in code mode.
  codeMode: FunctionTool[];
}

// What the seed's tools depend on at run time, so their handlers work in the lane.
export interface ForkSeedCapabilities {
  runtime: SubagentRuntime;
  runToolOptions: TaskMessageToolOptions;
  loadedToolGroups: string[];
  spinePath: string | null;
}

export interface ForkSeed {
  id: string;
  envelope: ForkSeedEnvelope;
  tools: ForkSeedTools;
  items: ResponseInputItem[];
  capabilities: ForkSeedCapabilities;
}

// The turn that produced the split call, as the agent loop sent it.
export interface SwarmTurnSnapshot {
  envelope: PromptEnvelope;
  responseTools: Tool[];
  codeModeTools: FunctionTool[];
}

// Queued conversation deltas are already in the conversation items, so only the prefix is kept.
export function snapshotForkEnvelope(envelope: PromptEnvelope): ForkSeedEnvelope {
  return structuredClone({ baseVersion: envelope.baseVersion, baseFrames: envelope.baseFrames, deltas: envelope.deltas });
}

// The lane's envelope is sealed from the start: anything added during its runs is appended to the
// end of its conversation, never to the inherited prefix.
export function restoreForkEnvelope(seed: ForkSeedEnvelope): PromptEnvelope {
  return { ...structuredClone(seed), sealed: true, conversationDeltas: [], drainedConversationDeltaCount: 0 };
}

export async function insertForkSeedInTx(client: PoolClient, seed: Omit<ForkSeed, "id"> & {
  swarmTaskId: string;
  sourceTaskId: string;
}): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO task_swarm_fork_seeds (swarm_task_id, source_task_id, envelope_json, tools_json, items_json, capabilities_json)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)
     RETURNING id`,
    [seed.swarmTaskId, seed.sourceTaskId, JSON.stringify(seed.envelope), JSON.stringify(seed.tools),
      JSON.stringify(seed.items), JSON.stringify(seed.capabilities)]
  );
  return result.rows[0].id;
}

export async function loadForkSeed(seedId: string): Promise<ForkSeed | null> {
  const result = await query<{
    id: string;
    envelope_json: ForkSeedEnvelope;
    tools_json: ForkSeedTools;
    items_json: ResponseInputItem[];
    capabilities_json: ForkSeedCapabilities;
  }>(
    "SELECT id, envelope_json, tools_json, items_json, capabilities_json FROM task_swarm_fork_seeds WHERE id = $1",
    [seedId]
  );
  const row = result.rows[0];
  return row
    ? { id: row.id, envelope: row.envelope_json, tools: row.tools_json, items: row.items_json, capabilities: row.capabilities_json }
    : null;
}

// Lanes run on the model and provider they were forked on.
export async function loadLaneRuntime(laneTaskId: string): Promise<SubagentRuntime | null> {
  const result = await query<{ runtime: SubagentRuntime | null }>(
    `SELECT seed.capabilities_json -> 'runtime' AS runtime
       FROM task_swarm_lanes lane
       JOIN task_swarm_fork_seeds seed ON seed.id = lane.fork_seed_id
      WHERE lane.task_id = $1`,
    [laneTaskId]
  );
  return result.rows[0]?.runtime ?? null;
}
