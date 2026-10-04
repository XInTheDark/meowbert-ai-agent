import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { parseToolArguments } from "../../agent/utils.js";
import { SEARCH_TOOLS_TOOL_NAME, searchToolsArgumentsSchema } from "../../code-mode/search-tools-tool.js";
import { searchTools } from "../../code-mode/tool-search.js";
import { finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

export async function handleSearchTools(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  const parsed = parseToolArguments(SEARCH_TOOLS_TOOL_NAME, outputItem.arguments, searchToolsArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const { group, query, names } = parsed.value;
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: names?.length ? "Tools" : query ? "Query" : "Group",
    inputText: names?.length ? names.join(", ") : [group, query].filter(Boolean).join(": ") || null
  });
  return finishBuiltinToolSuccess(ctx, execution, searchTools(ctx.codeModeTools ?? [], parsed.value));
}
