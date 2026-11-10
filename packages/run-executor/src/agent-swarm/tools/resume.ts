import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { resumeArgumentsSchema } from "../../agent-tools/swarm.js";
import { toolErrorResult, type ToolCallResult } from "../../agent-tool-dispatch/tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../agent-tool-dispatch/types.js";
import type { SwarmBackend } from "../backend.js";
import { buildResumeStartedMessage } from "../prompt.js";
import { runSwarmToolCall, swarmRunRef } from "./swarm-tool-call.js";

export async function handleResume(backend: SwarmBackend, call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  return runSwarmToolCall(call, ctx, resumeArgumentsSchema, async (args) => {
    if (ctx.codeModeParentCallId) return toolErrorResult("Call resume directly, not from exec.");
    await ctx.assertNotCancelled();
    const lane = await backend.resumeLane(swarmRunRef(ctx), {
      laneTaskId: args.lane_id,
      message: args.message,
      extraTokens: args.extra_tokens ?? null
    });
    state.swarmPark = { reason: "resume" };
    return { output: { resumed: true, message: buildResumeStartedMessage(lane.title) } };
  });
}
