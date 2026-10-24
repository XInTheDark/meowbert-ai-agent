import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { stopLaneArgumentsSchema } from "@meowbert/run-executor/agent-tools/swarm";
import { stopLane } from "../../../agent-swarm/lane-control.js";
import type { ToolCallResult } from "@meowbert/run-executor/agent-tool-dispatch/tool-call-result";
import type { ToolDispatchContext } from "@meowbert/run-executor/agent-tool-dispatch/types";
import { runSwarmToolCall } from "./swarm-tool-call.js";

export async function handleStopLane(call: ResponseFunctionToolCall, ctx: ToolDispatchContext): Promise<ToolCallResult> {
  return runSwarmToolCall(call, ctx, stopLaneArgumentsSchema, async (args) => {
    await stopLane({ swarm: ctx.swarm!.run, parentTaskId: ctx.taskId, laneTaskId: args.lane_id, discard: args.discard });
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
