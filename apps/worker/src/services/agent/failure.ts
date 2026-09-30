import {
  appendMessage,
  recordRunCompletion,
  setTaskBranchSelection,
  setTaskStatusForRun
} from "../agent-db/index.js";
import { buildAssistantHistoryItem } from "./utils.js";
import { emitTaskEvent } from "../runtime/events.js";
import { scheduleTaskRunRetry } from "../tasks/task-run-retry.js";
import { pauseInfiniteScheduleAfterCheckin } from "../task-schedules/service.js";
import { handleCancelledRun } from "./cancellation.js";
import type { AgentFailureContext } from "./execution-types.js";
import { countPreservedReasoningContentItems } from "./reasoning-content-count.js";

async function appendPersistedAssistantItems(execution: AgentFailureContext): Promise<void> {
  if (execution.prepared.runPersistedItems.length === 0) {
    return;
  }

  execution.state.currentLeafMessageId = await appendMessage(execution.job.taskId, "assistant", {
    text: "",
    response_items: execution.prepared.runPersistedItems
  }, {
    parentMessageId: execution.state.currentLeafMessageId,
    agentId: execution.prepared.runtimeAgentId,
    reasoningContentCount: countPreservedReasoningContentItems(execution.prepared.runPersistedItems)
  });
}

async function appendRetryNotice(execution: AgentFailureContext, retryNotice: string): Promise<void> {
  execution.state.currentLeafMessageId = await appendMessage(execution.job.taskId, "system", {
    text: retryNotice
  }, {
    parentMessageId: execution.state.currentLeafMessageId
  });

  if (execution.job.selectionUserId && execution.state.currentLeafMessageId) {
    await setTaskBranchSelection(execution.job.taskId, execution.job.selectionUserId, execution.state.currentLeafMessageId);
  }
}

async function appendFailureMessage(execution: AgentFailureContext, failureText: string): Promise<void> {
  const persistedFailureItems = execution.prepared.runPersistedItems.length > 0
    ? [...execution.prepared.runPersistedItems, buildAssistantHistoryItem(failureText)]
    : undefined;
  execution.state.currentLeafMessageId = await appendMessage(execution.job.taskId, "assistant", {
    text: failureText,
    ...(persistedFailureItems ? { response_items: persistedFailureItems } : {})
  }, {
    parentMessageId: execution.state.currentLeafMessageId,
    agentId: execution.prepared.runtimeAgentId,
    reasoningContentCount: countPreservedReasoningContentItems(execution.prepared.runPersistedItems)
  });

  if (execution.job.selectionUserId && execution.state.currentLeafMessageId) {
    await setTaskBranchSelection(execution.job.taskId, execution.job.selectionUserId, execution.state.currentLeafMessageId);
  }
}

export async function handleAgentRunFailure(execution: AgentFailureContext, error: unknown): Promise<void> {
  if (error instanceof Error && error.message === "TASK_CANCELLED") {
    await appendPersistedAssistantItems(execution);
    await handleCancelledRun(execution.job);
    return;
  }

  const retryResult = await scheduleTaskRunRetry({
    job: execution.job,
    error
  });
  if (retryResult.status === "scheduled") {
    await appendPersistedAssistantItems(execution);
    await appendRetryNotice(execution, retryResult.retryNotice);
    return;
  }
  if (retryResult.status === "noop") {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  const failureText = `Task failed: ${message}`;
  await appendFailureMessage(execution, failureText);
  if (execution.job.mode === "infinite_checkin") {
    await pauseInfiniteScheduleAfterCheckin(execution.job.taskId);
  }
  const updatedStatus = await setTaskStatusForRun(execution.job.taskId, execution.job.runId, "failed");
  await recordRunCompletion(execution.job.runId, "error", message);
  if (!updatedStatus) {
    return;
  }
  await emitTaskEvent(execution.job.taskId, "error", { message });
}
