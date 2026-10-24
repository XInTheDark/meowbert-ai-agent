import {
  appendMessage,
  recordRunCompletion,
  setTaskBranchSelection,
  setTaskStatusForRun
} from "../agent-db/index.js";
import { buildAssistantHistoryItem } from "@meowbert/run-executor/agent/utils";
import { emitTaskEvent } from "../runtime/events.js";
import { scheduleTaskRunRetry } from "../tasks/task-run-retry.js";
import { pauseInfiniteScheduleAfterCheckin } from "../task-schedules/service.js";
import { handleCancelledRun } from "./run-cancellation.js";
import { finishFailedLaneRun } from "../agent-swarm/run-finalize.js";
import type { TaskExecutionJob } from "@meowbert/shared";
import type { RunFailure } from "@meowbert/run-executor/agent/ports/run-control";

async function appendPersistedAssistantItems(job: TaskExecutionJob, failure: RunFailure, leaf: { id: string | null }): Promise<void> {
  if (failure.persistedItems.length === 0) {
    return;
  }

  leaf.id = await appendMessage(job.taskId, "assistant", {
    text: "",
    response_items: failure.persistedItems
  }, {
    parentMessageId: leaf.id,
    agentId: failure.agentId,
    reasoningContentCount: failure.reasoningContentCount
  });
}

async function appendBranchMessage(
  job: TaskExecutionJob,
  leaf: { id: string | null },
  role: "assistant" | "system",
  content: Record<string, unknown>,
  options: { agentId?: string | null; reasoningContentCount?: number } = {}
): Promise<void> {
  leaf.id = await appendMessage(job.taskId, role, content, { parentMessageId: leaf.id, ...options });
  if (job.selectionUserId && leaf.id) {
    await setTaskBranchSelection(job.taskId, job.selectionUserId, leaf.id);
  }
}

// Settles a run whose agent loop threw: cancellation and interrupts, a scheduled retry, or a
// failed task. Output the model produced before the failure stays on the branch.
export async function failServerRun(job: TaskExecutionJob, failure: RunFailure): Promise<void> {
  const leaf = { id: failure.currentLeafMessageId };
  if (failure.errorMessage === "TASK_CANCELLED") {
    await appendPersistedAssistantItems(job, failure, leaf);
    await handleCancelledRun(job);
    await finishFailedLaneRun(job, "cancelled", true);
    return;
  }

  const retryResult = await scheduleTaskRunRetry({
    job,
    error: new Error(failure.errorMessage)
  });
  if (retryResult.status === "scheduled") {
    await appendPersistedAssistantItems(job, failure, leaf);
    await appendBranchMessage(job, leaf, "system", { text: retryResult.retryNotice });
    return;
  }
  if (retryResult.status === "noop") {
    return;
  }

  const failureText = `Task failed: ${failure.errorMessage}`;
  const persistedFailureItems = failure.persistedItems.length > 0
    ? [...failure.persistedItems, buildAssistantHistoryItem(failureText)]
    : undefined;
  await appendBranchMessage(job, leaf, "assistant", {
    text: failureText,
    ...(persistedFailureItems ? { response_items: persistedFailureItems } : {})
  }, {
    agentId: failure.agentId,
    reasoningContentCount: failure.reasoningContentCount
  });
  if (job.mode === "infinite_checkin") {
    await pauseInfiniteScheduleAfterCheckin(job.taskId);
  }
  const updatedStatus = await setTaskStatusForRun(job.taskId, job.runId, "failed");
  await recordRunCompletion(job.runId, "error", failure.errorMessage);
  await finishFailedLaneRun(job, failure.errorMessage, false);
  if (!updatedStatus) {
    return;
  }
  await emitTaskEvent(job.taskId, "error", { message: failure.errorMessage });
}
