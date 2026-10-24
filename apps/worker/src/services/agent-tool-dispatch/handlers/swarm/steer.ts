import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { steerArgumentsSchema } from "@meowbert/run-executor/agent-tools/swarm";
import { steerLane } from "../../../agent-swarm/lane-control.js";
import type { ToolCallResult } from "@meowbert/run-executor/agent-tool-dispatch/tool-call-result";
import type { ToolDispatchContext } from "@meowbert/run-executor/agent-tool-dispatch/types";
import { runSwarmToolCall } from "./swarm-tool-call.js";

export async function handleSteer(call: ResponseFunctionToolCall, ctx: ToolDispatchContext): Promise<ToolCallResult> {
  return runSwarmToolCall(call, ctx, steerArgumentsSchema, async (args) => {
    await steerLane({ swarm: ctx.swarm!.run, parentTaskId: ctx.taskId, laneTaskId: args.lane_id, message: args.message });
    return { output: { steered: true, message: "The lane sees this at its next step." } };
  });
}
