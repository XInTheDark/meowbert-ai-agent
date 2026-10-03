import type { FunctionTool, ResponseFunctionToolCall, ResponseInputItem } from "openai/resources/responses/responses";
import type { ToolDispatchContext, ToolDispatchState } from "../agent-tool-dispatch/types.js";

export type NestedToolDispatcher = (
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
) => Promise<unknown>;

// Handlers write their output into the conversation. A nested call's output belongs to the script,
// not the model, so the handler gets a view of the run state whose conversation arrays are scratch
// space; every other field (command step counter, organization, budgets) stays shared with the run.
function createNestedState(state: ToolDispatchState, conversationItems: ResponseInputItem[]): ToolDispatchState {
  const runPersistedItems: ResponseInputItem[] = [];
  return new Proxy(state, {
    get(target, property, receiver) {
      if (property === "conversationItems") return conversationItems;
      if (property === "runPersistedItems") return runPersistedItems;
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (property === "conversationItems" || property === "runPersistedItems") return false;
      return Reflect.set(target, property, value, receiver);
    }
  });
}

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

function readCallOutput(items: ResponseInputItem[], callId: string): unknown {
  const item = items.find((entry) => entry.type === "function_call_output" && entry.call_id === callId);
  if (!item || item.type !== "function_call_output") {
    return { error: "The tool finished without returning output." };
  }
  if (typeof item.output !== "string") {
    return item.output;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(item.output);
  } catch {
    return item.output;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  // serializeToolOutput adds a context-usage notice meant for the model; the script doesn't need it.
  const { context: _context, ...rest } = parsed as Record<string, unknown>;
  const keys = Object.keys(rest);
  return keys.length === 1 && keys[0] === "result" ? rest.result : rest;
}

export async function dispatchNestedToolCall(input: {
  execCall: ResponseFunctionToolCall;
  index: number;
  tool: FunctionTool;
  args: unknown;
  ctx: ToolDispatchContext;
  state: ToolDispatchState;
  dispatch: NestedToolDispatcher;
}): Promise<unknown> {
  if (!input.args || typeof input.args !== "object" || Array.isArray(input.args)) {
    throw new Error(`tools.${input.tool.name} takes one arguments object.`);
  }

  const callId = `${input.execCall.call_id}.${input.index}`;
  const outputItem: ResponseFunctionToolCall = {
    type: "function_call",
    call_id: callId,
    name: input.tool.name,
    arguments: JSON.stringify(fillOmittedNullableArguments(input.tool, input.args as Record<string, unknown>))
  };
  const conversationItems: ResponseInputItem[] = [];
  await input.dispatch(
    outputItem,
    { ...input.ctx, codeModeParentCallId: input.execCall.call_id },
    createNestedState(input.state, conversationItems)
  );
  return readCallOutput(conversationItems, callId);
}
