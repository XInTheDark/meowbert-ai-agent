import type { FunctionTool, ResponseFunctionToolCall } from "openai/resources/responses/responses";
import type { ToolCallResult } from "../agent-tool-dispatch/tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../agent-tool-dispatch/types.js";
import { normalizeToolArguments } from "../agent-tool-dispatch/normalize-tool-arguments.js";

export type NestedToolDispatcher = (
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
) => Promise<ToolCallResult>;

export async function dispatchNestedToolCall(input: {
  execCall: ResponseFunctionToolCall;
  index: number;
  tool: FunctionTool;
  args: unknown;
  ctx: ToolDispatchContext;
  state: ToolDispatchState;
  dispatch: NestedToolDispatcher;
}): Promise<ToolCallResult> {
  if (!input.args || typeof input.args !== "object" || Array.isArray(input.args)) {
    throw new Error(`tools.${input.tool.name} takes one arguments object.`);
  }

  const outputItem: ResponseFunctionToolCall = {
    type: "function_call",
    call_id: `${input.execCall.call_id}.${input.index}`,
    name: input.tool.name,
    arguments: JSON.stringify(normalizeToolArguments(input.tool.parameters, input.args as Record<string, unknown>))
  };
  return input.dispatch(outputItem, { ...input.ctx, codeModeParentCallId: input.execCall.call_id }, input.state);
}
