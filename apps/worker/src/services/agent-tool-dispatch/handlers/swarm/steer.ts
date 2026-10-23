import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { steerArgumentsSchema } from "../../../agent-tools/swarm.js";
import { steerLane } from "../../../agent-swarm/lane-control.js";
import type { ToolCallResult } from "../../tool-call-result.js";
import type { ToolDispatchContext } from "../../types.js";
import { runLaneControlCall } from "./lane-control-call.js";

export async function handleSteer(call: ResponseFunctionToolCall, ctx: ToolDispatchContext): Promise<ToolCallResult> {
  return runLaneControlCall(call, ctx, steerArgumentsSchema, async (args) => {
    await steerLane({ swarm: ctx.swarm!.run, parentTaskId: ctx.taskId, laneTaskId: args.lane_id, message: args.message });
    return { output: { steered: true, message: "The lane sees this at its next step." } };
  });
}
