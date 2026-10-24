import type { PoolClient } from "pg";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { query } from "../../lib/db.js";
import type { SubagentRuntime } from "@meowbert/run-executor/subagents/types";
import type { ForkSeed, ForkSeedCapabilities, ForkSeedEnvelope, ForkSeedTools } from "@meowbert/run-executor/agent-swarm/fork-types";

export * from "@meowbert/run-executor/agent-swarm/fork-types";

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
