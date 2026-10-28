import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  INDEX_LOOKUP_TOOL_NAME,
  INDEX_SAVE_TOOL_NAME,
  indexLookupArgumentsSchema,
  indexSaveArgumentsSchema
} from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import type { FileIndexRoots } from "../../file-index/locations.js";
import { lookupIndex } from "../../file-index/lookup.js";
import { saveIndexEntry } from "../../file-index/save.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { getErrorMessage, rethrowIfTaskCancelled } from "../utils.js";

function fileIndexRoots(ctx: ToolDispatchContext): FileIndexRoots {
  return { workspaceRoot: ctx.workspaceRoot, envRoot: ctx.envRoot, projectId: ctx.environmentId };
}

export async function handleIndexLookup(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(INDEX_LOOKUP_TOOL_NAME, outputItem.arguments, indexLookupArgumentsSchema);
  if (!parsed.ok) return toolErrorResult(parsed.error);
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, { inputLabel: "Path", inputText: parsed.value.path });
  if (ctx.memoryEnabled !== true) {
    return finishBuiltinToolFailure(ctx, execution, "The file index needs Memory, which is off for this workspace.");
  }

  try {
    return await finishBuiltinToolSuccess(ctx, execution, await lookupIndex(fileIndexRoots(ctx), parsed.value.path));
  } catch (error) {
    rethrowIfTaskCancelled(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to look up the index: ${getErrorMessage(error)}`);
  }
}

export async function handleIndexSave(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(INDEX_SAVE_TOOL_NAME, outputItem.arguments, indexSaveArgumentsSchema);
  if (!parsed.ok) return toolErrorResult(parsed.error);
  const args = parsed.value;
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, { inputLabel: "Sources", inputText: args.sources.join("\n") });
  if (ctx.memoryEnabled !== true) {
    return finishBuiltinToolFailure(ctx, execution, "The file index needs Memory, which is off for this workspace.");
  }
  if (ctx.isThreadTask) {
    return finishBuiltinToolFailure(ctx, execution, "This run is read-only, so it can't save index entries.");
  }

  try {
    const result = await saveIndexEntry(fileIndexRoots(ctx), {
      sources: args.sources,
      summary: args.summary,
      mode: args.mode,
      name: args.name ?? null
    });
    return await finishBuiltinToolSuccess(ctx, execution, result);
  } catch (error) {
    rethrowIfTaskCancelled(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to save the index entry: ${getErrorMessage(error)}`);
  }
}
