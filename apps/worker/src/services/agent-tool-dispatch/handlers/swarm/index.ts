import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { SHARE_TOOL_NAME, SPLIT_TOOL_NAME, SUBMIT_TOOL_NAME } from "../../../agent-tools/swarm.js";
import { toolErrorResult, type ToolCallResult } from "../../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../../types.js";
import { handleShare } from "./share.js";
import { handleSplit } from "./split.js";
import { handleSubmit } from "./submit.js";

export async function handleSwarmTool(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  switch (call.name) {
    case SPLIT_TOOL_NAME: return handleSplit(call, ctx, state);
    case SHARE_TOOL_NAME: return handleShare(call, ctx);
    case SUBMIT_TOOL_NAME: return handleSubmit(call, ctx, state);
    default: return toolErrorResult(`Unknown swarm tool: ${call.name}`);
  }
}
