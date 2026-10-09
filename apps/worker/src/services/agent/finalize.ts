import type { ConversationSnapshot } from "@meowbert/shared";
import { parkForSubagentMail } from "../subagents/wait.js";
import {
  appendMessage,
  recordRunCompletion,
  setTaskBranchSelection,
  setTaskStatusForRun
} from "../agent-db/index.js";
import { buildAssistantHistoryItem } from "./utils.js";
import { completeTaskRun } from "../tasks/complete-task-run.js";
import { wakeRunDeliveryLoop } from "../notifications/run-delivery-loop.js";
import {
  applyInfiniteWait,
  pauseInfiniteScheduleAfterCheckin,
  pauseTimedScheduleAfterCompletion
} from "../task-schedules/service.js";
import {
  DEFAULT_INFINITE_AUTO_WAIT_SECONDS,
  shouldAutoApplyInfiniteWait,
  shouldPauseTimedScheduleAfterCompletion
} from "../tasks/recurring-run-utils.js";
import { emitTaskEvent } from "../runtime/events.js";
import { markWorkflowCompleted } from "../task-workflows/service.js";
import { linkContextNodeToVisibleMessage } from "../context-management-v2/index.js";
import type { AgentExecutionContext } from "./execution-types.js";
import { countPreservedReasoningContentItems } from "./reasoning-content-count.js";
import {
  syncFinishedMemorySynthesisRequests,
  triggerAutomaticMemorySynthesis
} from "../memory-synthesis/service.js";

const ASSISTANT_LOG_MESSAGE_MAX_CHARS = 100;
const MIN_FINAL_RESPONSE_OVERLAP_CHARS = 40;

type FinalResponseSource = "final_response" | "stop" | "wait" | "none";

interface ResolvedFinalResponse {
  response: string;
  source: FinalResponseSource;
}

function truncateAssistantLogMessage(message: string): string {
  if (message.length <= ASSISTANT_LOG_MESSAGE_MAX_CHARS) {
    return message;
  }

  return `${message.slice(0, ASSISTANT_LOG_MESSAGE_MAX_CHARS - 3)}...`;
}

function hasCompatibilityMode(execution: AgentExecutionContext, mode: "forceFixDoubleResponse"): boolean {
  return execution.prepared.runtimeCompatibilityModes.includes(mode);
}

function forceFixDoubleResponse(response: string): string {
  if (response.trim().length === 0) {
    return response;
  }

  const maxPartLength = Math.floor(response.length / 2);
  for (let partLength = maxPartLength; partLength > 0; partLength -= 1) {
    const first = response.slice(0, partLength);
    if (first.trim().length === 0) {
      continue;
    }

    let offset = partLength;
    let copyCount = 1;
    while (offset < response.length) {
      const whitespaceLength = response.slice(offset).match(/^\s*/)?.[0].length ?? 0;
      const nextOffset = offset + whitespaceLength;
      if (response.slice(nextOffset, nextOffset + partLength) !== first) {
        break;
      }
      copyCount += 1;
      offset = nextOffset + partLength;
    }

    if (copyCount > 1 && response.slice(offset).trim().length === 0) {
      return first;
    }
  }

  return response;
}

function findLargestTextOverlap(left: string, right: string): number {
  const maxOverlap = Math.min(left.length, right.length);
  for (let overlap = maxOverlap; overlap >= MIN_FINAL_RESPONSE_OVERLAP_CHARS; overlap -= 1) {
    if (left.endsWith(right.slice(0, overlap))) {
      return overlap;
    }
  }

  return 0;
}

function appendFinalResponseSegment(current: string, next: string): string {
  if (current.length === 0) {
    return next;
  }
  if (next.length === 0 || current.endsWith(next)) {
    return current;
  }
  if (next.startsWith(current)) {
    return next;
  }

  const overlap = findLargestTextOverlap(current, next);
  if (overlap > 0) {
    return `${current}${next.slice(overlap)}`;
  }

  return `${current}\n\n${next}`;
}

function resolveFinalResponseSegments(
  segments: Array<{ response: string; notify: boolean; partial: boolean }>
): string | null {
  let lastFinalIndex = -1;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (!segments[index].partial) {
      lastFinalIndex = index;
      break;
    }
  }
  if (lastFinalIndex === -1) {
    return null;
  }

  let previousFinalIndex = -1;
  for (let index = lastFinalIndex - 1; index >= 0; index -= 1) {
    if (!segments[index].partial) {
      previousFinalIndex = index;
      break;
    }
  }
  return segments
    .slice(previousFinalIndex + 1, lastFinalIndex + 1)
    .map((segment) => segment.response)
    .reduce(appendFinalResponseSegment, "");
}

function resolveNotificationRequested(execution: AgentExecutionContext): boolean {
  let notificationRequested = true;
  if (execution.state.stopRequest) {
    notificationRequested = execution.state.stopRequest.notify;
  } else if (execution.state.waitRequest) {
    notificationRequested = execution.state.waitRequest.notify;
  } else if (execution.state.finalResponseFromTool) {
    notificationRequested = execution.state.finalResponseFromTool.notify;
  }

  return execution.prepared.isSubtask ? false : notificationRequested;
}

function maybeFixFinalResponse(
  execution: AgentExecutionContext,
  resolved: ResolvedFinalResponse
): ResolvedFinalResponse {
  if (resolved.source !== "final_response" || !hasCompatibilityMode(execution, "forceFixDoubleResponse")) {
    return resolved;
  }

  return {
    ...resolved,
    response: forceFixDoubleResponse(resolved.response)
  };
}

function resolveFinalResponse(execution: AgentExecutionContext): ResolvedFinalResponse {
  const finalResponseSegments = execution.state.dispatchState.finalResponseSegments ?? [];
  const segmentedResponse = resolveFinalResponseSegments(finalResponseSegments);
  if (segmentedResponse !== null) {
    return maybeFixFinalResponse(execution, {
      response: segmentedResponse,
      source: "final_response"
    });
  }

  if (execution.state.stopRequest) {
    return {
      response: execution.state.stopRequest.response,
      source: "stop"
    };
  }

  if (execution.state.waitRequest) {
    return {
      response: execution.state.waitRequest.response,
      source: "wait"
    };
  }

  if (execution.state.finalResponseFromTool) {
    return maybeFixFinalResponse(execution, {
      response: execution.state.finalResponseFromTool.response,
      source: "final_response"
    });
  }

  return {
    response: "",
    source: "none"
  };
}

function shouldAllowFinalizeAfterSelfQueuedContinuation(execution: AgentExecutionContext): boolean {
  const workflowContext = execution.workflow.workflowContext;
  if (!workflowContext) {
    return false;
  }

  if (workflowContext.workflowType === "agent_swarm") {
    return execution.state.waitRequest?.nextRunAt !== null;
  }

  return workflowContext.workflowType === "long_horizon"
    && execution.state.workflowPauseRequest?.kind === "long_horizon_started";
}

async function assertRunCanFinalize(execution: AgentExecutionContext): Promise<void> {
  if (execution.runControl.runTimedOut) {
    return;
  }

  if (!shouldAllowFinalizeAfterSelfQueuedContinuation(execution)) {
    await execution.assertRunNotAborted();
    return;
  }

  await execution.prepared.cancellationMonitor.assertNotCancelled({
    allowNewerAttempt: true
  });
}

async function maybeAutoApplyRecurringWait(execution: AgentExecutionContext): Promise<void> {
  if (!shouldAutoApplyInfiniteWait({
    runMode: execution.job.mode,
    hasWaitRequest: execution.state.waitRequest !== null,
    hasStopRequest: execution.state.stopRequest !== null,
    timedRunFinalizing: execution.runControl.timedRunFinalizing
  })) {
    return;
  }

  try {
    await applyInfiniteWait(execution.job.taskId, DEFAULT_INFINITE_AUTO_WAIT_SECONDS);
  } catch {
    // Best-effort fallback to avoid stalling infinite tasks if wait was omitted.
  }
}

async function appendAssistantRunMessage(execution: AgentExecutionContext, finalResponse: string, assistantPauseText: string): Promise<void> {
  const shouldAppendAssistantMessage =
    finalResponse.length > 0
    || assistantPauseText.length > 0
    || (execution.workflow.workflowContext === null && execution.prepared.runPersistedItems.length > 0);
  if (!shouldAppendAssistantMessage) {
    return;
  }

  const organization = execution.state.dispatchState.organization;
  const snapshots: Array<Pick<ConversationSnapshot, "kind" | "payload_json">> = [];
  const final = execution.state.finalResponseFromTool;
  if (organization && final?.summary && !final.partial && finalResponse) {
    if (organization.outlineChanged && organization.outline !== null) snapshots.push({ kind: "outline", payload_json: { markdown: organization.outline } });
    if (organization.mapChanged && organization.graph) snapshots.push({ kind: "map", payload_json: organization.graph });
  }
  execution.state.currentLeafMessageId = await appendMessage(
    execution.job.taskId,
    "assistant",
    {
      text: finalResponse.length > 0 ? finalResponse : assistantPauseText,
      ...(organization && final?.summary && !final.partial ? { turn_summary: final.summary } : {}),
      ...(execution.prepared.runPersistedItems.length > 0 ? { response_items: execution.prepared.runPersistedItems } : {})
    },
    {
      ...(snapshots.length ? { organizationSnapshots: snapshots } : {}),
      parentMessageId: execution.state.currentLeafMessageId,
      agentId: execution.prepared.runtimeAgentId,
      reasoningContentCount: countPreservedReasoningContentItems(execution.prepared.runPersistedItems)
    }
  );

  if (execution.state.contextManagement?.version === "v2" && execution.state.currentLeafMessageId) {
    execution.state.contextManagement = await linkContextNodeToVisibleMessage({
      state: execution.state.contextManagement,
      visibleMessageId: execution.state.currentLeafMessageId
    });
  }

  if (execution.job.selectionUserId && execution.state.currentLeafMessageId) {
    await setTaskBranchSelection(execution.job.taskId, execution.job.selectionUserId, execution.state.currentLeafMessageId);
  }
}

async function completeRunWithTaskStatus(
  execution: AgentExecutionContext,
  status: "queued" | "awaiting_input" | "succeeded",
  notificationRequested = false
): Promise<boolean> {
  const updatedStatus = await setTaskStatusForRun(execution.job.taskId, execution.job.runId, status);
  await recordRunCompletion(
    execution.job.runId,
    "completed",
    undefined,
    notificationRequested
  );
  return updatedStatus;
}

async function maybeFinalizeWorkflowRun(execution: AgentExecutionContext, input: {
  hasFinalResponse: boolean;
  hasAssistantPauseText: boolean;
}): Promise<boolean> {
  const workflowContext = execution.workflow.workflowContext;
  if (!workflowContext) {
    return false;
  }

  if (input.hasFinalResponse) {
    const completedWorkflow = await markWorkflowCompleted(workflowContext, {
      keepRunId: execution.job.runId,
      currentRunId: execution.job.runId
    });
    if (!completedWorkflow) {
      await recordRunCompletion(execution.job.runId, "completed", undefined, false);
      return true;
    }
    return false;
  }

  if (input.hasAssistantPauseText && execution.job.mode === "long_horizon_clarify") {
    await completeRunWithTaskStatus(execution, "awaiting_input");
    return true;
  }

  if (execution.state.workflowPauseRequest?.awaitUser) {
    await completeRunWithTaskStatus(execution, "awaiting_input", true);
    return true;
  }

  if (execution.state.workflowPauseRequest) {
    await completeRunWithTaskStatus(execution, "queued");
    return true;
  }

  if (!input.hasFinalResponse && !input.hasAssistantPauseText) {
    await completeRunWithTaskStatus(execution, "awaiting_input");
    return true;
  }

  return false;
}

async function finalizeSucceededRun(execution: AgentExecutionContext, finalResponse: string, notificationRequested: boolean): Promise<void> {
  const updatedStatus = await completeTaskRun({
    taskId: execution.job.taskId,
    runId: execution.job.runId,
    finalResponse,
    notificationRequested,
    isSubtask: execution.prepared.isSubtask,
    connectorContextId: execution.prepared.snapshot.task.connector_context_id,
    workspaceId: execution.prepared.snapshot.task.workspace_id,
    environmentId: execution.prepared.snapshot.task.environment_id,
    taskTitle: execution.prepared.snapshot.task.title,
    targetUserId: execution.job.selectionUserId ?? execution.prepared.snapshot.task.initiator_user_id ?? null
  });
  if (!updatedStatus) return;
  wakeRunDeliveryLoop();

  if (shouldPauseTimedScheduleAfterCompletion({
    isTimedInfiniteRun: execution.runControl.isTimedInfiniteRun,
    timedRunFinalizing: execution.runControl.timedRunFinalizing,
    hasWaitRequest: execution.state.waitRequest !== null,
    hasStopRequest: execution.state.stopRequest !== null
  })) {
    await pauseTimedScheduleAfterCompletion(execution.job.taskId);
  }
  if (execution.job.mode === "infinite_checkin") {
    await pauseInfiniteScheduleAfterCheckin(execution.job.taskId);
  }

  if (execution.job.mode === "memory_synthesis") {
    void syncFinishedMemorySynthesisRequests().catch((error) => {
      console.error("Unable to finalize memory synthesis request", error);
    });
    return;
  }

  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    void triggerAutomaticMemorySynthesis({
      workspaceId: execution.prepared.snapshot.task.workspace_id,
      environmentId: execution.prepared.snapshot.task.environment_id
    }).catch((error) => {
      console.error("Unable to evaluate automatic Memory refresh", error);
    });
  }
}

export async function finalizeAgentRun(execution: AgentExecutionContext): Promise<void> {
  if (execution.state.dispatchState.subagentWaitDeadline) {
    await assertRunCanFinalize(execution);
    await appendAssistantRunMessage(execution, "", "");
    await parkForSubagentMail({ ...execution.job, branchMessageId: execution.state.currentLeafMessageId ?? undefined },
      execution.state.dispatchState.subagentWaitDeadline);
    await emitTaskEvent(execution.job.taskId, "status", { status: "queued", waitingForSubagents: true });
    return;
  }
  execution.state.notificationRequested = resolveNotificationRequested(execution);
  let finalResponse = resolveFinalResponse(execution).response;
  const isRecurringRunMode =
    execution.job.mode === "scheduled_auto"
    || execution.job.mode === "infinite_auto"
    || execution.job.mode === "infinite_checkin";

  await maybeAutoApplyRecurringWait(execution);
  if (!finalResponse && !isRecurringRunMode && execution.workflow.workflowContext === null) {
    await execution.debugLogger.log("Finalizing run without an explicit final response.", {
      stage: "run.finalize.missing_final_response",
      phase: "warn",
      reachedMaxRunSteps: execution.runControl.reachedMaxRunSteps,
      runTimedOut: execution.runControl.runTimedOut,
      timedRunFinalizing: execution.runControl.timedRunFinalizing,
      hasWaitRequest: execution.state.waitRequest !== null,
      hasStopRequest: execution.state.stopRequest !== null,
      hasToolFinalResponse: execution.state.finalResponseFromTool !== null,
      persistedItemCount: execution.prepared.runPersistedItems.length,
      mode: execution.job.mode ?? "default"
    });
    finalResponse = execution.runControl.reachedMaxRunSteps
      ? "Reached max reasoning steps; please send a follow-up message to continue."
      : "The run stopped before producing a final response; please send a follow-up message to continue.";
  }

  const assistantPauseText = execution.state.workflowAssistantPauseResponse?.trim() ?? "";
  const hasFinalResponse = finalResponse.trim().length > 0;
  const hasAssistantPauseText = assistantPauseText.length > 0;
  if (!hasFinalResponse && !hasAssistantPauseText) {
    execution.state.notificationRequested = false;
  }
  await assertRunCanFinalize(execution);

  if (hasFinalResponse) {
    execution.prepared.runPersistedItems.push(buildAssistantHistoryItem(finalResponse));
  }
  await appendAssistantRunMessage(execution, hasFinalResponse ? finalResponse : "", assistantPauseText);

  if (hasFinalResponse) {
    await emitTaskEvent(execution.job.taskId, "log", { message: truncateAssistantLogMessage(finalResponse) });
  } else if (hasAssistantPauseText) {
    await emitTaskEvent(execution.job.taskId, "log", { message: truncateAssistantLogMessage(assistantPauseText) });
  }

  if (await maybeFinalizeWorkflowRun(execution, { hasFinalResponse, hasAssistantPauseText })) {
    return;
  }

  await finalizeSucceededRun(execution, finalResponse, execution.state.notificationRequested);
}
