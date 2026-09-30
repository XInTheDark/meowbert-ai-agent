import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME,
  contextCheckpointAndCompactArgumentsSchema,
  contextCheckpointAndTrimArgumentsSchema
} from "../../agent-tools/index.js";
import { assertContextTrimCountAvailable } from "../../context-management/index.js";
import { finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

function parseArguments(outputItem: ResponseFunctionToolCall): unknown {
  try {
    return JSON.parse(outputItem.arguments) as unknown;
  } catch {
    throw new Error("Context management tool arguments must be valid JSON.");
  }
}

export async function handleContextManagementTool(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  if (state.pendingContextManagementAction) {
    throw new Error("Only one context management action may be requested in a model turn.");
  }

  const rawArguments = parseArguments(outputItem);

  if (outputItem.name === CONTEXT_CHECKPOINT_AND_COMPACT_TOOL_NAME) {
    const args = contextCheckpointAndCompactArgumentsSchema.parse(rawArguments);
    const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
      inputLabel: "Checkpoint",
      inputText: args.checkpoint
    });
    await finishBuiltinToolSuccess(ctx, state, execution, {
      accepted: true,
      action: "compact"
    });
    state.pendingContextManagementAction = {
      kind: "compact",
      checkpoint: args.checkpoint,
      callId: outputItem.call_id
    };
    return;
  }

  const args = contextCheckpointAndTrimArgumentsSchema.parse(rawArguments);
  assertContextTrimCountAvailable({
    conversationItems: state.conversationItems,
    triggeringCallId: outputItem.call_id,
    count: args.count
  });
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Checkpoint",
    inputText: args.checkpoint
  });
  await finishBuiltinToolSuccess(ctx, state, execution, {
    accepted: true,
    action: "trim",
    count: args.count
  });
  state.pendingContextManagementAction = {
    kind: "trim",
    checkpoint: args.checkpoint,
    toolSummary: args.tool_summary,
    count: args.count,
    callId: outputItem.call_id
  };
}
