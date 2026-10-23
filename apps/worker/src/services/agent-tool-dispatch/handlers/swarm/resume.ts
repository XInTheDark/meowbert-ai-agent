import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { resumeArgumentsSchema } from "../../../agent-tools/swarm.js";
import { resumeLane } from "../../../agent-swarm/lane-control.js";
import { buildResumeStartedMessage } from "../../../agent-swarm/prompt.js";
import { toolErrorResult, type ToolCallResult } from "../../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../types.js";
import { runLaneControlCall } from "./lane-control-call.js";

export async function handleResume(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  return runLaneControlCall(call, ctx, resumeArgumentsSchema, async (args) => {
    if (ctx.codeModeParentCallId) return toolErrorResult("Call resume directly, not from exec.");
    await ctx.assertNotCancelled();
    const lane = await resumeLane({ swarm: ctx.swarm!.run, parentTaskId: ctx.taskId, laneTaskId: args.lane_id, message: args.message });
    state.swarmPark = { reason: "resume" };
    return { output: { resumed: true, message: buildResumeStartedMessage(lane.title) } };
  });
}
