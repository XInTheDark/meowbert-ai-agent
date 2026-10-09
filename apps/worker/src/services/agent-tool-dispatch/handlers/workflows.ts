import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import {
  ASSIGN_WORKER_TOOL_NAME,
  CREATE_CHANNEL_TOOL_NAME,
  SWARM_BUDGET_STATUS_TOOL_NAME,
  SWARM_CANCEL_NODE_TOOL_NAME,
  SWARM_GRANT_BUDGET_TOOL_NAME,
  SWARM_MANAGE_TOOL_NAME,
  SWARM_SPAWN_NODE_TOOL_NAME,
  SWARM_RECORD_FINAL_REVIEW_TOOL_NAME,
  SWARM_RECORD_REVIEW_TOOL_NAME,
  LIST_CHANNELS_TOOL_NAME,
  REQUEST_CLARIFICATION_TOOL_NAME,
  READ_CHANNEL_TOOL_NAME,
  SEND_CHANNEL_MESSAGE_TOOL_NAME,
  START_LONG_HORIZON_TASK_TOOL_NAME,
  SUBMIT_SWARM_OUTPUT_TOOL_NAME,
  SUBMIT_RESPONSE_TOOL_NAME,
  SUBMIT_REVIEW_TOOL_NAME,
  assignWorkerArgumentsSchema,
  createChannelArgumentsSchema,
  swarmBudgetStatusArgumentsSchema,
  swarmCancelNodeArgumentsSchema,
  swarmGrantBudgetArgumentsSchema,
  swarmManageArgumentsSchema,
  swarmSpawnNodeArgumentsSchema,
  swarmRecordFinalReviewArgumentsSchema,
  swarmRecordReviewArgumentsSchema,
  listChannelsArgumentsSchema,
  readChannelArgumentsSchema,
  requestClarificationArgumentsSchema,
  sendChannelMessageArgumentsSchema,
  startLongHorizonTaskArgumentsSchema,
  submitResponseArgumentsSchema,
  submitReviewArgumentsSchema,
  submitSwarmOutputArgumentsSchema
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

// A swarm pause ends the run; a stalled swarm hands the task back to the user instead.
export function withSwarmPause(result: ToolCallResult, status: string, escalation: string | null): ToolCallResult {
  return {
    ...result,
    workflowPause: escalation
      ? { kind: "agent_swarm_paused", response: escalation, awaitUser: true }
      : { kind: "agent_swarm_paused", response: status }
  };
}

export async function handleAssignWorker(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(ASSIGN_WORKER_TOOL_NAME, outputItem.arguments, assignWorkerArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: `Assign ${parsed.value.workers.join(", ")}`,
    inputText: parsed.value.message
  });

  if (!ctx.workflowActions?.assignSwarmWorkers) {
    return finishBuiltinToolFailure(ctx, execution, "assign_worker is only available to an Agent Swarm leader.");
  }

  try {
    const result = await ctx.workflowActions.assignSwarmWorkers({
      ...(parsed.value.target_swarm ? { targetSwarm: parsed.value.target_swarm } : {}),
      workers: parsed.value.workers,
      message: parsed.value.message,
      wait: parsed.value.wait
    });
    const finished = await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      message_no: result.messageNo,
      assigned: result.assigned,
      started: result.started,
      paused: result.paused
    });
    return result.paused
      ? withSwarmPause(finished, `Waiting for ${result.assigned.join(", ")}.`, result.escalation)
      : finished;
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to assign swarm workers: ${message}`);
  }
}

export async function handleSwarmManage(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SWARM_MANAGE_TOOL_NAME, outputItem.arguments, swarmManageArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Swarm workers",
    inputText: parsed.value.view_only ? "View workers" : summarizeToolEventValue(parsed.value) ?? "Manage workers"
  });

  if (!ctx.workflowActions?.manageSwarmWorkers) {
    return finishBuiltinToolFailure(ctx, execution, "swarm_manage is only available to an Agent Swarm leader.");
  }

  try {
    const result = await ctx.workflowActions.manageSwarmWorkers({
      ...(parsed.value.target_swarm ? { targetSwarm: parsed.value.target_swarm } : {}),
      start: parsed.value.start,
      stop: parsed.value.stop,
      grantBudget: parsed.value.grant_budget ?? [],
      viewOnly: parsed.value.view_only
    });
    return await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      started: result.started,
      stopped: result.stopped,
      granted: result.granted,
      workers: result.workers.map((worker) => ({
        task_id: worker.taskId,
        label: worker.label,
        status: worker.status,
        stopped: worker.stopped,
        paused: worker.paused,
        pause_reason: worker.pauseReason,
        wait_for_task_ids: worker.waitingForTaskIds,
        waiting_for: worker.waitingForTaskIds.map((taskId) => result.agents.find((agent) => agent.taskId === taskId)?.label ?? taskId)
      })),
      agents: result.agents.map((agent) => ({
        task_id: agent.taskId,
        label: agent.label,
        status: agent.status,
        stopped: agent.stopped,
        paused: agent.paused,
        pause_reason: agent.pauseReason,
        wait_for_task_ids: agent.waitingForTaskIds,
        waiting_for: agent.waitingForTaskIds.map((taskId) => result.agents.find((peer) => peer.taskId === taskId)?.label ?? taskId)
      }))
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to manage swarm workers: ${message}`);
  }
}

export async function handleSwarmBudgetStatus(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(
    SWARM_BUDGET_STATUS_TOOL_NAME,
    outputItem.arguments,
    swarmBudgetStatusArgumentsSchema
  );
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Swarm budget",
    inputText: "Inspect Swarm budget"
  });
  if (!ctx.workflowActions?.getSwarmBudgetStatus) {
    return finishBuiltinToolFailure(ctx, execution, "swarm_budget_status is only available during Agent Swarm runs.");
  }

  try {
    const result = await ctx.workflowActions.getSwarmBudgetStatus(parsed.value.target_swarm ?? undefined);
    return await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      status: result.status,
      remaining_tokens: result.remainingTokens,
      unassigned_tokens: result.unassignedTokens,
      deadline_at: result.deadlineAt,
      minimum_spawn_allocation_tokens: result.minimumSpawnAllocationTokens,
      workers: result.workers.map((worker) => ({
        task_id: worker.taskId,
        status: worker.status,
        remaining_tokens: worker.remainingTokens
      })),
      children: result.children.map((child) => ({
        node_id: child.nodeId,
        title: child.title,
        status: child.status,
        remaining_tokens: child.remainingTokens,
        deadline_at: child.deadlineAt,
        minimum_grant_tokens: child.minimumGrantTokens
      }))
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to inspect Swarm budget: ${message}`);
  }
}

export async function handleSwarmSpawnNode(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SWARM_SPAWN_NODE_TOOL_NAME, outputItem.arguments, swarmSpawnNodeArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Spawn Swarm node",
    inputText: parsed.value.title
  });
  if (!ctx.workflowActions?.spawnSwarmNode) {
    return finishBuiltinToolFailure(ctx, execution, "swarm_spawn_node is only available to an Agent Swarm leader.");
  }
  try {
    const result = await ctx.workflowActions.spawnSwarmNode({
      targetSwarm: parsed.value.target_swarm ?? undefined,
      nodeTypeId: parsed.value.node_type_id,
      title: parsed.value.title,
      initialInstruction: parsed.value.initial_instruction,
      tokenBudget: parsed.value.token_budget,
      timeBudgetMinutes: parsed.value.time_budget_minutes
    });
    return await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      node_id: result.nodeId,
      title: result.title,
      status: result.status,
      leader_task_id: result.leaderTaskId,
      worker_task_ids: result.workerTaskIds,
      allocated_tokens: result.allocatedTokens,
      deadline_at: result.deadlineAt
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to spawn Swarm node: ${message}`);
  }
}

export async function handleSwarmGrantBudget(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SWARM_GRANT_BUDGET_TOOL_NAME, outputItem.arguments, swarmGrantBudgetArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Grant Swarm budget",
    inputText: `${parsed.value.node_id}: ${parsed.value.additional_tokens}`
  });
  if (!ctx.workflowActions?.grantSwarmBudget) {
    return finishBuiltinToolFailure(ctx, execution, "swarm_grant_budget is only available to an Agent Swarm leader.");
  }
  try {
    const result = await ctx.workflowActions.grantSwarmBudget({
      targetSwarm: parsed.value.target_swarm ?? undefined,
      nodeId: parsed.value.node_id,
      additionalTokens: parsed.value.additional_tokens,
      extendDeadlineMinutes: parsed.value.extend_deadline_minutes
    });
    return await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      node_id: result.nodeId,
      allocated_tokens: result.allocatedTokens,
      remaining_tokens: result.remainingTokens,
      deadline_at: result.deadlineAt,
      resumed: result.resumed
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to grant Swarm budget: ${message}`);
  }
}

export async function handleSwarmCancelNode(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SWARM_CANCEL_NODE_TOOL_NAME, outputItem.arguments, swarmCancelNodeArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Cancel Swarm node",
    inputText: parsed.value.reason
  });
  if (!ctx.workflowActions?.cancelSwarmNode) {
    return finishBuiltinToolFailure(ctx, execution, "swarm_cancel_node is only available to an Agent Swarm leader.");
  }
  try {
    const result = await ctx.workflowActions.cancelSwarmNode({
      targetSwarm: parsed.value.target_swarm ?? undefined,
      nodeId: parsed.value.node_id,
      reason: parsed.value.reason
    });
    return await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      node_id: result.nodeId,
      cancelled_node_ids: result.cancelledNodeIds
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to cancel Swarm node: ${message}`);
  }
}

export async function handleSwarmRecordReview(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SWARM_RECORD_REVIEW_TOOL_NAME, outputItem.arguments, swarmRecordReviewArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Swarm review",
    inputText: parsed.value.summary
  });
  if (!ctx.workflowActions?.recordSwarmReviewRound) {
    return finishBuiltinToolFailure(ctx, execution, "swarm_record_review is only available when a swarm review round is required.");
  }
  try {
    const result = await ctx.workflowActions.recordSwarmReviewRound({
      ...(parsed.value.target_swarm ? { targetSwarm: parsed.value.target_swarm } : {}),
      reviewer: parsed.value.reviewer,
      summary: parsed.value.summary
    });
    return await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      reviewer: result.reviewerLabel,
      completed_rounds: result.completedRounds,
      required_rounds: result.requiredRounds
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to record swarm review: ${message}`);
  }
}

export async function handleSwarmRecordFinalReview(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SWARM_RECORD_FINAL_REVIEW_TOOL_NAME, outputItem.arguments, swarmRecordFinalReviewArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Final swarm review",
    inputText: parsed.value.summary
  });
  if (!ctx.workflowActions?.recordSwarmFinalReview) {
    return finishBuiltinToolFailure(ctx, execution, "swarm_record_final_review is not available in this run.");
  }
  try {
    const result = await ctx.workflowActions.recordSwarmFinalReview({
      ...(parsed.value.target_swarm ? { targetSwarm: parsed.value.target_swarm } : {}),
      reviewer: parsed.value.reviewer,
      approved: parsed.value.approved,
      summary: parsed.value.summary
    });
    return await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      reviewer: result.reviewerLabel,
      approved: result.approved
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to record final swarm review: ${message}`);
  }
}

export async function handleListChannels(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(LIST_CHANNELS_TOOL_NAME, outputItem.arguments, listChannelsArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Channels",
    inputText: "List swarm channels"
  });

  if (!ctx.workflowActions?.listSwarmChannels) {
    return finishBuiltinToolFailure(ctx, execution, "list_channels is not available in this run.");
  }

  try {
    const channels = parsed.value.target_swarm
      ? await ctx.workflowActions.listSwarmChannels(parsed.value.target_swarm)
      : await ctx.workflowActions.listSwarmChannels();
    return await finishBuiltinToolSuccess(ctx, execution, {
      items: channels
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to list swarm channels: ${message}`);
  }
}

export async function handleReadChannel(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(READ_CHANNEL_TOOL_NAME, outputItem.arguments, readChannelArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Read channel",
    inputText: summarizeToolEventValue(parsed.value) ?? parsed.value.channel_id
  });

  if (!ctx.workflowActions?.readSwarmChannel) {
    return finishBuiltinToolFailure(ctx, execution, "read_channel is not available in this run.");
  }

  try {
    const result = await ctx.workflowActions.readSwarmChannel({
      ...(parsed.value.target_swarm ? { targetSwarm: parsed.value.target_swarm } : {}),
      channelId: parsed.value.channel_id,
      sinceMessageNo: parsed.value.since_message_no ?? null
    });
    return await finishBuiltinToolSuccess(ctx, execution, {
      channel_id: result.channelId,
      messages: result.messages
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to read swarm channel: ${message}`);
  }
}

export async function handleCreateChannel(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(CREATE_CHANNEL_TOOL_NAME, outputItem.arguments, createChannelArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Create channel",
    inputText: summarizeToolEventValue(parsed.value) ?? "Create swarm channel"
  });

  if (!ctx.workflowActions?.createSwarmChannel) {
    return finishBuiltinToolFailure(ctx, execution, "create_channel is not available in this run.");
  }

  try {
    const result = await ctx.workflowActions.createSwarmChannel({
      ...(parsed.value.target_swarm ? { targetSwarm: parsed.value.target_swarm } : {}),
      memberAgentTaskIds: parsed.value.member_agent_task_ids,
      title: parsed.value.title ?? null
    });
    return await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      channel_id: result.channelId,
      kind: result.kind,
      title: result.title,
      member_task_ids: result.memberTaskIds
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to create swarm channel: ${message}`);
  }
}

export async function handleSendChannelMessage(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SEND_CHANNEL_MESSAGE_TOOL_NAME, outputItem.arguments, sendChannelMessageArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Channel message",
    inputText: parsed.value.message
  });

  if (!ctx.workflowActions?.sendSwarmChannelMessage) {
    return finishBuiltinToolFailure(ctx, execution, "send_channel_message is not available in this run.");
  }

  try {
    const result = await ctx.workflowActions.sendSwarmChannelMessage({
      ...(parsed.value.target_swarm ? { targetSwarm: parsed.value.target_swarm } : {}),
      channelId: parsed.value.channel_id,
      message: parsed.value.message
    });
    return await finishBuiltinToolSuccess(ctx, execution, {
      ok: true,
      message_no: result.messageNo,
      created_at: result.createdAt
    });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to send swarm message: ${message}`);
  }
}

export async function handleSubmitSwarmOutput(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(SUBMIT_SWARM_OUTPUT_TOOL_NAME, outputItem.arguments, submitSwarmOutputArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Swarm output",
    inputText: parsed.value.response
  });
  if (!ctx.workflowActions?.submitSwarmOutput) {
    return finishBuiltinToolFailure(ctx, execution, "submit_swarm_output is not available in this run.");
  }
  try {
    const result = parsed.value.target_swarm
      ? await ctx.workflowActions.submitSwarmOutput(parsed.value.response, parsed.value.target_swarm)
      : await ctx.workflowActions.submitSwarmOutput(parsed.value.response);
    return await finishBuiltinToolSuccess(ctx, execution, { ok: true, message_no: result.messageNo });
  } catch (error) {
    rethrowIfTaskCancelled(error);
    const message = error instanceof Error ? error.message : String(error);
    return finishBuiltinToolFailure(ctx, execution, `Failed to publish swarm output: ${message}`);
  }
}
