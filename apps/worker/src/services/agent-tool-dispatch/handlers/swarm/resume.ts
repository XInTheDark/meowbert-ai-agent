import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { resumeArgumentsSchema } from "@meowbert/run-executor/agent-tools/swarm";
import { resumeLane } from "../../../agent-swarm/lane-control.js";
import { buildResumeStartedMessage } from "@meowbert/run-executor/agent-swarm/prompt";
import { toolErrorResult, type ToolCallResult } from "@meowbert/run-executor/agent-tool-dispatch/tool-call-result";
import type { ToolDispatchContext, ToolDispatchState } from "@meowbert/run-executor/agent-tool-dispatch/types";
import { runSwarmToolCall } from "./swarm-tool-call.js";

export async function handleResume(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  return runSwarmToolCall(call, ctx, resumeArgumentsSchema, async (args) => {
    if (ctx.codeModeParentCallId) return toolErrorResult("Call resume directly, not from exec.");
    await ctx.assertNotCancelled();
    const swarm = ctx.swarm!.run;
    const lane = await resumeLane({
      swarm,
      parentTaskId: ctx.taskId,
      laneTaskId: args.lane_id,
      message: args.message,
      extraTokens: args.extra_tokens
    });
    state.swarmPark = { reason: "resume" };
    return { output: { resumed: true, message: buildResumeStartedMessage(lane.title) } };
  });
}
