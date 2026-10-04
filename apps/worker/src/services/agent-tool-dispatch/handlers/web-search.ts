import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { SEARCH_WEB_TOOL_NAME, searchWebArgumentsSchema } from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled } from "../utils.js";

export async function handleSearchWeb(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SEARCH_WEB_TOOL_NAME, outputItem.arguments, searchWebArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Query",
    inputText: parsed.value.query
  });

  try {
    if (!ctx.searchWeb) {
      throw new Error("Web search is not available for this model.");
    }
    const answer = await ctx.searchWeb(parsed.value.query);
    return await finishBuiltinToolSuccess(ctx, execution, { answer }, {
      eventPayload: { answerLength: answer.length }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Web search failed: ${message}`);
  }
}
