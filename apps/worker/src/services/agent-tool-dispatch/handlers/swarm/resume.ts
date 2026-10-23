import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { resumeArgumentsSchema } from "../../../agent-tools/swarm.js";
import { addResumeShareInTx } from "../../../agent-swarm/budget-shares.js";
import { resumeLane } from "../../../agent-swarm/lane-control.js";
import { buildResumeStartedMessage } from "../../../agent-swarm/prompt.js";
import { toolErrorResult, type ToolCallResult } from "../../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../types.js";
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
      addShare: (client, resumed) => addResumeShareInTx(client, swarm, ctx.taskId, resumed.task_id, args.extra_tokens)
    });
    state.swarmPark = { reason: "resume" };
    return { output: { resumed: true, message: buildResumeStartedMessage(lane.title) } };
  });
}
