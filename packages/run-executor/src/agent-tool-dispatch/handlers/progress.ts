import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { normalizeTaskProgress } from "@meowbert/shared";
import { UPDATE_PROGRESS_TOOL_NAME, updateProgressArgumentsSchema } from "../../agent-tools/progress.js";
import { parseToolArguments } from "../../agent/utils.js";
import { finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

// The progress rides on the tool message, where the activity card reads it; the model only needs
// to know it landed.
export async function handleUpdateProgress(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  const parsed = parseToolArguments(UPDATE_PROGRESS_TOOL_NAME, outputItem.arguments, updateProgressArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const progress = normalizeTaskProgress(parsed.value);
  if (!progress) {
    return toolErrorResult("Give a goal or at least one step.");
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Progress",
    inputText: [progress.goal, ...progress.steps.map((step) => `[${step.status}] ${step.title}`)].filter(Boolean).join("\n")
  });
  return finishBuiltinToolSuccess(ctx, execution, { ok: true }, { messagePayload: { progress } });
}
