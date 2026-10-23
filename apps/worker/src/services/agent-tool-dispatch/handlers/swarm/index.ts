import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  CHECK_TOOL_NAME,
  DIVERGE_TOOL_NAME,
  RESUME_TOOL_NAME,
  SHARE_TOOL_NAME,
  SPLIT_TOOL_NAME,
  STEER_TOOL_NAME,
  STOP_LANE_TOOL_NAME,
  SUBMIT_TOOL_NAME
} from "../../../agent-tools/swarm.js";
import { toolErrorResult, type ToolCallResult } from "../../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../types.js";
import { handleCheck } from "./check.js";
import { handleDiverge } from "./diverge.js";
import { handleResume } from "./resume.js";
import { handleShare } from "./share.js";
import { handleSplit } from "./split.js";
import { handleSteer } from "./steer.js";
import { handleStopLane } from "./stop.js";
import { handleSubmit } from "./submit.js";

export async function handleSwarmTool(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  switch (call.name) {
    case SPLIT_TOOL_NAME: return handleSplit(call, ctx, state);
    case DIVERGE_TOOL_NAME: return handleDiverge(call, ctx, state);
    case CHECK_TOOL_NAME: return handleCheck(call, ctx, state);
    case STEER_TOOL_NAME: return handleSteer(call, ctx);
    case STOP_LANE_TOOL_NAME: return handleStopLane(call, ctx);
    case RESUME_TOOL_NAME: return handleResume(call, ctx, state);
    case SHARE_TOOL_NAME: return handleShare(call, ctx);
    case SUBMIT_TOOL_NAME: return handleSubmit(call, ctx, state);
    default: return toolErrorResult(`Unknown swarm tool: ${call.name}`);
  }
}
