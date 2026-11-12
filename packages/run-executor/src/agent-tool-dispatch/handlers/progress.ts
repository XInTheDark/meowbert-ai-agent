import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { applyTaskProgressUpdate, isEmptyTaskProgressUpdate, type TaskProgress } from "@meowbert/shared";
import { UPDATE_PROGRESS_TOOL_NAME, updateProgressArgumentsSchema } from "../../agent-tools/progress.js";
import { parseToolArguments } from "../../agent/utils.js";
import { finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";

function describeProgress(progress: TaskProgress): string {
  const steps = progress.steps.map((step) => [`[${step.status}] ${step.title}`, step.note].filter(Boolean).join("\n  "));
  return [progress.goal, progress.status, ...steps].filter(Boolean).join("\n\n");
}

// The task keeps one plan across runs. An update merges into it and the merged plan rides on the
// tool message, where the activity card reads it. A call with every field null reads it back.
export async function handleUpdateProgress(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  const parsed = parseToolArguments(UPDATE_PROGRESS_TOOL_NAME, outputItem.arguments, updateProgressArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const current = await ctx.control.loadTaskProgress();
  if (isEmptyTaskProgressUpdate(parsed.value)) {
    const execution = await startBuiltinToolExecution(ctx, state, outputItem, { inputLabel: "Progress", inputText: "View plan" });
    return finishBuiltinToolSuccess(ctx, execution, { progress: current ?? "No plan yet." });
  }

  const progress = applyTaskProgressUpdate(current, parsed.value);
  if (!progress) {
    return toolErrorResult("Give a goal, a status or at least one step.");
  }
  await ctx.control.saveTaskProgress(progress);
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Progress",
    inputText: describeProgress(progress)
  });
  return finishBuiltinToolSuccess(ctx, execution, { ok: true }, { messagePayload: { progress } });
}
