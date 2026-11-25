import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { listLanesArgumentsSchema } from "../../agent-tools/swarm.js";
import type { ToolCallResult } from "../../agent-tool-dispatch/tool-call-result.js";
import type { ToolDispatchContext } from "../../agent-tool-dispatch/types.js";
import type { SwarmBackend } from "../backend.js";
import { ACTIVE_LANE_STATUSES, type SwarmLaneListing } from "../lane-types.js";
import { runSwarmToolCall, swarmRunRef } from "./swarm-tool-call.js";

// Safety cap when list_lanes is called directly (outside exec, e.g. when code mode is disabled).
export const DIRECT_LIST_LANES_MAX_CHARS = 20_000;

function isPriorityLane(lane: SwarmLaneListing): boolean {
  return ACTIVE_LANE_STATUSES.includes(lane.status) || lane.resumable;
}

// Keep active and resumable lanes first, then the most recent remaining lanes, within the budget.
function limitDirectLaneListing(lanes: SwarmLaneListing[], maxChars: number): {
  lanes: SwarmLaneListing[];
  truncated: boolean;
} {
  if (JSON.stringify(lanes).length <= maxChars) {
    return { lanes, truncated: false };
  }

  const prioritizedIndices: number[] = [];
  const otherIndices: number[] = [];
  lanes.forEach((lane, index) => {
    (isPriorityLane(lane) ? prioritizedIndices : otherIndices).push(index);
  });
  const candidateOrder = [...prioritizedIndices, ...otherIndices.reverse()];

  const keptIndices = new Set<number>();
  let usedChars = 2; // "[]"
  for (const index of candidateOrder) {
    const entryChars = JSON.stringify(lanes[index]).length + (keptIndices.size > 0 ? 1 : 0);
    if (keptIndices.size > 0 && usedChars + entryChars > maxChars) continue;
    keptIndices.add(index);
    usedChars += entryChars;
  }

  return {
    lanes: lanes.filter((_, index) => keptIndices.has(index)),
    truncated: keptIndices.size < lanes.length
  };
}

export async function handleListLanes(backend: SwarmBackend, call: ResponseFunctionToolCall, ctx: ToolDispatchContext): Promise<ToolCallResult> {
  return runSwarmToolCall(call, ctx, listLanesArgumentsSchema, async () => {
    const lanes = await backend.listLanes(swarmRunRef(ctx));
    if (lanes.length === 0) {
      return { output: { lanes, message: "You have not started any lanes." } };
    }
    if (ctx.codeModeParentCallId) {
      return { output: { lanes } };
    }
    const bounded = limitDirectLaneListing(lanes, DIRECT_LIST_LANES_MAX_CHARS);
    return {
      output: bounded.truncated
        ? {
            lanes: bounded.lanes,
            total_lanes: lanes.length,
            omitted_lanes: lanes.length - bounded.lanes.length,
            truncated: true
          }
        : { lanes: bounded.lanes }
    };
  });
}
