import type { TaskMessageToolOptions } from "../agent/types.js";
import type { SubagentRuntime } from "../subagents/types.js";
import type { SwarmRunContext } from "./run-context.js";
import type { ForkCompactor } from "./fork-compaction.js";
import type { SwarmTurnSnapshot } from "./fork-types.js";

// What swarm tool handlers get from the agent loop: the swarm the run belongs to and an exact
// snapshot of the turn that produced the call, which a split forks from.
export interface SwarmDispatchContext {
  run: SwarmRunContext;
  turn: SwarmTurnSnapshot & {
    // Conversation items sent in the turn's request; the response and its outputs come after.
    requestItemCount: number;
  };
  runtime: SubagentRuntime;
  runToolOptions: TaskMessageToolOptions;
  loadedToolGroups: string[];
  compactForFork: ForkCompactor;
}
