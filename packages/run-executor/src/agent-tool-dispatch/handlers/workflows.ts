import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  REQUEST_CLARIFICATION_TOOL_NAME,
  START_LONG_HORIZON_TASK_TOOL_NAME,
  SUBMIT_RESPONSE_TOOL_NAME,
  SUBMIT_REVIEW_TOOL_NAME,
  requestClarificationArgumentsSchema,
  startLongHorizonTaskArgumentsSchema,
  submitResponseArgumentsSchema,
  submitReviewArgumentsSchema
} from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled, summarizeToolEventValue } from "../utils.js";

export async function handleStartLongHorizonTask(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(
    START_LONG_HORIZON_TASK_TOOL_NAME,
    outputItem.arguments,
    startLongHorizonTaskArgumentsSchema
  );
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Plan",
    inputText: parsed.value.plan
  });

  if (!ctx.workflowActions?.startLongHorizonTask) {
    return finishBuiltinToolFailure(ctx, execution, "start_long_horizon_task is not available in this run.");
  }

  try {
    const result = await ctx.workflowActions.startLongHorizonTask(parsed.value.plan);
    const finished = await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      plan_path: result.planPath,
      next_run_id: result.nextRunId
    });
    return { ...finished, workflowPause: { kind: "long_horizon_started" } };
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to start Long Horizon task: ${message}`);
  }
}

export function handleRequestClarification(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext
): ToolCallResult {
  const parsed = parseToolArguments(
    REQUEST_CLARIFICATION_TOOL_NAME,
    outputItem.arguments,
    requestClarificationArgumentsSchema
  );
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const workflow = ctx.workflowContext;
  if (
    workflow?.workflowType !== "long_horizon"
    || ctx.runMode !== "long_horizon_clarify"
    || workflow.phase !== "clarify"
  ) {
    return toolErrorResult("request_clarification is only available during the Long Horizon clarify stage.");
  }

  return {
    output: { ok: true, awaiting_input: true },
    workflowPause: { kind: "long_horizon_clarification_requested", response: parsed.value.question }
  };
}

export async function handleSubmitResponse(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SUBMIT_RESPONSE_TOOL_NAME, outputItem.arguments, submitResponseArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Submission",
    inputText: parsed.value.message
  });

  if (!ctx.workflowActions?.submitLongHorizonResponse) {
    return finishBuiltinToolFailure(ctx, execution, "submit_response is not available in this run.");
  }

  try {
    const result = await ctx.workflowActions.submitLongHorizonResponse(parsed.value.message);
    const finished = await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      round_no: result.roundNo,
      reviewer_task_ids: result.reviewerTaskIds
    });
    return { ...finished, workflowPause: { kind: "long_horizon_submitted" } };
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to submit Long Horizon work: ${message}`);
  }
}

export async function handleSubmitReview(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SUBMIT_REVIEW_TOOL_NAME, outputItem.arguments, submitReviewArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Review",
    inputText: summarizeToolEventValue(parsed.value) ?? parsed.value.review
  });

  if (!ctx.workflowActions?.submitLongHorizonReview) {
    return finishBuiltinToolFailure(ctx, execution, "submit_review is not available in this run.");
  }

  try {
    const result = await ctx.workflowActions.submitLongHorizonReview(parsed.value.review, parsed.value.approved);
    const finished = await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      round_no: result.roundNo,
      approved_count: result.approvedCount,
      rejected_count: result.rejectedCount,
      total_count: result.totalCount,
      majority: result.majority,
      outcome: result.outcome
    });
    return { ...finished, workflowPause: { kind: "long_horizon_reviewed" } };
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to submit review: ${message}`);
  }
}
