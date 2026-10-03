import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { parseToolArguments } from "../../agent/utils.js";
import { SEARCH_TOOLS_TOOL_NAME, searchToolsArgumentsSchema } from "../../code-mode/search-tools-tool.js";
import { searchTools } from "../../code-mode/tool-search.js";
import { finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { pushParseError } from "../state.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

export async function handleSearchTools(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  const parsed = parseToolArguments(SEARCH_TOOLS_TOOL_NAME, outputItem.arguments, searchToolsArgumentsSchema);
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return;
  }

  const { group, query, names } = parsed.value;
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: names?.length ? "Tools" : query ? "Query" : "Group",
    inputText: names?.length ? names.join(", ") : [group, query].filter(Boolean).join(": ") || null
  });
  await finishBuiltinToolSuccess(ctx, state, execution, searchTools(ctx.codeModeTools ?? [], parsed.value));
}
