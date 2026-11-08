import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { READ_TASK_EVIDENCE_TOOL_NAME, readTaskEvidenceArgumentsSchema } from "../../agent-tools/memory-evidence.js";
import { parseToolArguments } from "../../agent/utils.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { getErrorMessage, rethrowIfTaskCancelled } from "../utils.js";

export async function handleReadTaskEvidence(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(READ_TASK_EVIDENCE_TOOL_NAME, call.arguments, readTaskEvidenceArgumentsSchema);
  if (!parsed.ok) return toolErrorResult(parsed.error);
  if (!ctx.memoryEnabled || ctx.allowTaskHistoryTools === false) return toolErrorResult("Memory evidence is disabled for this run.");
  const execution = await startBuiltinToolExecution(ctx, state, call, { inputLabel: "Source task", inputText: parsed.value.task_id });
  try {
    return await finishBuiltinToolSuccess(ctx, execution, await ctx.control.platform.readTaskEvidence(parsed.value));
  } catch (error) {
    rethrowIfTaskCancelled(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to read task evidence: ${getErrorMessage(error)}`);
  }
}
