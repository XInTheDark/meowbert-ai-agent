import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { SEARCH_WEB_TOOL_NAME, searchWebArgumentsSchema } from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { pushParseError } from "../state.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled } from "../utils.js";

export async function handleSearchWeb(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SEARCH_WEB_TOOL_NAME, outputItem.arguments, searchWebArgumentsSchema);
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return;
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
    await finishBuiltinToolSuccess(ctx, state, execution, { answer }, {
      eventPayload: { answerLength: answer.length }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    await finishBuiltinToolFailure(ctx, state, execution, `Web search failed: ${message}`);
  }
}
