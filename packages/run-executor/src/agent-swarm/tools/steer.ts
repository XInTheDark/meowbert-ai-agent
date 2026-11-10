import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { steerArgumentsSchema } from "../../agent-tools/swarm.js";
import type { ToolCallResult } from "../../agent-tool-dispatch/tool-call-result.js";
import type { ToolDispatchContext } from "../../agent-tool-dispatch/types.js";
import type { SwarmBackend } from "../backend.js";
import { runSwarmToolCall, swarmRunRef } from "./swarm-tool-call.js";

export async function handleSteer(backend: SwarmBackend, call: ResponseFunctionToolCall, ctx: ToolDispatchContext): Promise<ToolCallResult> {
  return runSwarmToolCall(call, ctx, steerArgumentsSchema, async (args) => {
    await backend.steerLane(swarmRunRef(ctx), { laneTaskId: args.lane_id, message: args.message });
    return { output: { steered: true, message: "The lane sees this at its next step." } };
  });
}
