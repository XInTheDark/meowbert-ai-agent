import type { ResponseInputItem } from "openai/resources/responses/responses";
import { recordContextItems, resolveContextManagementState } from "@meowbert/run-executor/context-management-v2/window";
import type { RunContextStore } from "@meowbert/run-executor/agent/ports/run-control";
import type { TaskMessageRow } from "@meowbert/run-executor/agent/types";
import { loadForkSeed } from "./fork-seed.js";
import { restoreForkEnvelope, type ForkSeed, type LaneRunSetup } from "@meowbert/run-executor/agent-swarm/fork-types";

export type { LaneRunSetup } from "@meowbert/run-executor/agent-swarm/fork-types";
import type { SwarmLaneRow } from "./lane-store.js";

// The lane's own result for the split call, written with its first message when it was forked.
export function findLaneForkOutput(messages: TaskMessageRow[]): ResponseInputItem | null {
  for (const message of messages) {
    const content = message.content_json as { swarm_fork_output?: ResponseInputItem } | null;
    if (message.role === "user" && content?.swarm_fork_output) return content.swarm_fork_output;
  }
  return null;
}

// A lane on a different model than its parent (a router pick) inherits the messages and tool calls but
// not the parent's reasoning items, which only its own provider can read. It shares no cache anyway.
export function inheritedItems(seed: Pick<ForkSeed, "items" | "capabilities">, runtimeModel: string): ResponseInputItem[] {
  const items = structuredClone(seed.items);
  if (seed.capabilities.runtime.model === runtimeModel) return items;
  return items.filter((item) => (item as { type?: string }).type !== "reasoning");
}

// Forked lanes never go through normal run setup: every run, resumes included, uses the seed's
// envelope and its window items exactly as stored, with no window notes prepended and no live state
// appended, so the prefix stays identical across the lane's runs and to its parent's up to the fork.
export async function prepareLaneRun(input: {
  contextStore: RunContextStore;
  taskId: string;
  lane: Pick<SwarmLaneRow, "fork_seed_id">;
  messages: TaskMessageRow[];
  branchLeafMessageId: string | null;
  runtimeModel: string;
}): Promise<LaneRunSetup> {
  const seed = input.lane.fork_seed_id ? await loadForkSeed(input.lane.fork_seed_id) : null;
  if (!seed) throw new Error("This lane's fork is no longer available.");
  const resolved = await resolveContextManagementState(input.contextStore, {
    taskId: input.taskId,
    requestedVersion: "v2",
    runtimeModel: input.runtimeModel,
    branchLeafMessageId: input.branchLeafMessageId,
    seedItems: []
  });
  if (resolved.state.version !== "v2") throw new Error("Agent Swarm lanes need context management v2.");
  let conversationItems = resolved.conversationItems;
  if (conversationItems.length === 0) {
    const forkOutput = findLaneForkOutput(input.messages);
    if (!forkOutput) throw new Error("This lane has no fork result to start from.");
    conversationItems = [...inheritedItems(seed, input.runtimeModel), forkOutput];
    await recordContextItems(input.contextStore, resolved.state, conversationItems, { preserveItems: true });
  }
  return {
    seed,
    promptEnvelope: restoreForkEnvelope(seed.envelope),
    contextManagement: resolved.state,
    conversationItems
  };
}
