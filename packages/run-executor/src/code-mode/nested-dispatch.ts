import type { FunctionTool, ResponseFunctionToolCall } from "openai/resources/responses/responses";
import type { ToolCallResult } from "../agent-tool-dispatch/tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../agent-tool-dispatch/types.js";

export type NestedToolDispatcher = (
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
) => Promise<ToolCallResult>;

// Strict schemas mark every key required; scripts may leave nullable ones out.
function fillOmittedNullableArguments(tool: FunctionTool, args: Record<string, unknown>): Record<string, unknown> {
  const properties = (tool.parameters as { properties?: Record<string, { type?: unknown }> } | null)?.properties ?? {};
  const filled = { ...args };
  for (const [name, schema] of Object.entries(properties)) {
    const types = Array.isArray(schema?.type) ? schema.type : [schema?.type];
    if (!(name in filled) && types.includes("null")) {
      filled[name] = null;
    }
  }
  return filled;
}

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
    arguments: JSON.stringify(fillOmittedNullableArguments(input.tool, input.args as Record<string, unknown>))
  };
  return input.dispatch(outputItem, { ...input.ctx, codeModeParentCallId: input.execCall.call_id }, input.state);
}
