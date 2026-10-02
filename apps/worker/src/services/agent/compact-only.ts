import { emitTaskEvent } from "../runtime/events.js";
import { recordRunCompletion, setTaskStatusForRun } from "../agent-db/index.js";
import { compactContextNow } from "../context-compaction/index.js";
import { resetV2ContextWindow } from "./context-window.js";
import { persistContextCheckpoint } from "../context-management/index.js";
import { reconstructResponseInputItems } from "./utils.js";
import { resolveRunUsageBilling } from "./usage-billing.js";
import type { AgentExecutionContext } from "./execution-types.js";

export async function maybeHandleCompactOnlyRun(execution: AgentExecutionContext): Promise<boolean> {
  if (execution.job.mode !== "compact_only") {
    return false;
  }

  if (execution.job.contextAction === "clear") {
    if (!execution.manualClearItems) {
      throw new Error("Manual clear history was not prepared.");
    }
    const reconstructedItems = reconstructResponseInputItems(execution.manualClearItems, { omitReasoning: true });
    if (execution.state.contextManagement.version === "v2") {
      await resetV2ContextWindow(execution, "manual_clear", reconstructedItems);
    } else {
      execution.state.dispatchState.conversationItems.splice(
        0,
        execution.state.dispatchState.conversationItems.length,
        ...reconstructedItems
      );
      await persistContextCheckpoint({
        taskId: execution.job.taskId,
        action: "clear",
        checkpoint: "Context was manually cleared and reconstructed from the current task history. Reasoning items were omitted.",
        conversationItems: execution.state.dispatchState.conversationItems,
        runPersistedItems: execution.state.dispatchState.runPersistedItems,
        getCurrentLeafMessageId: () => execution.state.currentLeafMessageId,
        setCurrentLeafMessageId: (messageId: string) => {
          execution.state.currentLeafMessageId = messageId;
        }
      });
    }
    await emitTaskEvent(execution.job.taskId, "log", {
      message: "Context cleared and reconstructed.",
      trigger: "manual",
      contextAction: "clear",
      reasoningItemsOmitted: true,
      itemCount: reconstructedItems.length,
      contextManagementVersion: execution.state.contextManagement.version
    });
    await setTaskStatusForRun(
      execution.job.taskId,
      execution.job.runId,
      execution.job.restoreStatus ?? "awaiting_input"
    );
    await recordRunCompletion(execution.job.runId, "completed");
    return true;
  }

  if (execution.state.contextManagement.version === "v2") {
    await resetV2ContextWindow(execution, "manual");
    await emitTaskEvent(execution.job.taskId, "log", {
      message: "Context compaction completed.",
      trigger: "manual",
      contextManagementVersion: "v2"
    });
    await setTaskStatusForRun(
      execution.job.taskId,
      execution.job.runId,
      execution.job.restoreStatus ?? "awaiting_input"
    );
    await recordRunCompletion(execution.job.runId, "completed");
    return true;
  }

  const compactResult = await compactContextNow({
    provider: execution.prepared.runtimeProvider,
    billing: resolveRunUsageBilling(execution),
    taskId: execution.job.taskId,
    step: 0,
    model: execution.prepared.runtimeModel,
    compactionBackend: execution.prepared.snapshot.compaction_backend,
    requestTimeoutMs: execution.prepared.snapshot.model_request_timeout_ms,
    abortSignal: execution.runControl.runAbortSignal,
    maxContextTokens: execution.prepared.maxContextTokens,
    platformModelMetadata: execution.prepared.snapshot.platform_model_metadata,
    systemPrompt: execution.systemPrompt,
    conversationItems: execution.state.dispatchState.conversationItems,
    runPersistedItems: execution.state.dispatchState.runPersistedItems,
    getCurrentLeafMessageId: () => execution.state.currentLeafMessageId,
    setCurrentLeafMessageId: (messageId: string) => {
      execution.state.currentLeafMessageId = messageId;
    }
  });

  if (compactResult.status === "error") {
    throw new Error(`Context compaction failed: ${compactResult.reason ?? "unknown error"}`);
  }

  await emitTaskEvent(execution.job.taskId, "log", {
    message: "Context compaction completed.",
    trigger: "manual",
    usageBefore: compactResult.usageBefore,
    usageAfter: compactResult.usageAfter
  });
  await setTaskStatusForRun(
    execution.job.taskId,
    execution.job.runId,
    execution.job.restoreStatus ?? "awaiting_input"
  );
  await recordRunCompletion(execution.job.runId, "completed");
  return true;
}
