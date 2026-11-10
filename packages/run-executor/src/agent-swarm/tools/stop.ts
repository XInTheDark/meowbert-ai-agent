import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { stopLaneArgumentsSchema } from "../../agent-tools/swarm.js";
import type { ToolCallResult } from "../../agent-tool-dispatch/tool-call-result.js";
import type { ToolDispatchContext } from "../../agent-tool-dispatch/types.js";
import type { SwarmBackend } from "../backend.js";
import { runSwarmToolCall, swarmRunRef } from "./swarm-tool-call.js";

export async function handleStopLane(backend: SwarmBackend, call: ResponseFunctionToolCall, ctx: ToolDispatchContext): Promise<ToolCallResult> {
  return runSwarmToolCall(call, ctx, stopLaneArgumentsSchema, async (args) => {
    await backend.stopLane(swarmRunRef(ctx), { laneTaskId: args.lane_id, discard: args.discard });
    return {
      output: {
        stopped: true,
        message: args.discard
          ? "The lane and its sub-lanes are cancelled; their results are dropped."
          : "The lane and its sub-lanes submit what they have at their next step."
      }
    };
  });
}
