import type { RunContextStore } from "@meowbert/run-executor/agent/ports/run-control";
import type { TaskMessageRow } from "@meowbert/run-executor/agent/types";
import { prepareLaneRun as prepareLaneRunFromSeed } from "@meowbert/run-executor/agent-swarm/lane-run";
import type { LaneRunSetup } from "@meowbert/run-executor/agent-swarm/fork-types";
import { loadForkSeed } from "./fork-seed.js";
import type { SwarmLaneRow } from "./lane-store.js";

export { findLaneForkOutput, inheritedItems } from "@meowbert/run-executor/agent-swarm/lane-run";
export type { LaneRunSetup } from "@meowbert/run-executor/agent-swarm/fork-types";

// A lane's run setup from its stored fork seed.
export async function prepareLaneRun(input: {
  contextStore: RunContextStore;
  taskId: string;
  lane: Pick<SwarmLaneRow, "fork_seed_id">;
  messages: TaskMessageRow[];
  branchLeafMessageId: string | null;
  runtimeModel: string;
}): Promise<LaneRunSetup> {
  const seed = input.lane.fork_seed_id ? await loadForkSeed(input.lane.fork_seed_id) : null;
  return prepareLaneRunFromSeed({ ...input, seed });
}
