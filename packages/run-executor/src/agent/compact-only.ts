import { compactContextNow } from "../context-compaction/index.js";
import { resetV2ContextWindow } from "./context-window.js";
import { persistContextCheckpoint } from "../context-management/index.js";
import { reconstructResponseInputItems } from "./utils.js";
import { buildCompactionRunFields } from "./compaction-input.js";
import type { AgentExecutionContext } from "./execution-types.js";

// The task goes back to the status it had before the compaction was requested.
async function finishCompactOnlyRun(execution: AgentExecutionContext): Promise<void> {
  await execution.prepared.control.complete({
    kind: "status",
    status: execution.job.restoreStatus ?? "awaiting_input"
  });
}

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
        control: execution.prepared.control,
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
    await execution.prepared.control.emitEvent("log", {
      message: "Context cleared and reconstructed.",
      trigger: "manual",
      contextAction: "clear",
      reasoningItemsOmitted: true,
      itemCount: reconstructedItems.length,
      contextManagementVersion: execution.state.contextManagement.version
    });
    await finishCompactOnlyRun(execution);
    return true;
  }

  if (execution.state.contextManagement.version === "v2") {
    await resetV2ContextWindow(execution, "manual");
    await execution.prepared.control.emitEvent("log", {
      message: "Context compaction completed.",
      trigger: "manual",
      contextManagementVersion: "v2"
    });
    await finishCompactOnlyRun(execution);
    return true;
  }

  const compactResult = await compactContextNow({
    ...buildCompactionRunFields(execution, 0, execution.runTiming.runAbortSignal),
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

  await execution.prepared.control.emitEvent("log", {
    message: "Context compaction completed.",
    trigger: "manual",
    usageBefore: compactResult.usageBefore,
    usageAfter: compactResult.usageAfter
  });
  await finishCompactOnlyRun(execution);
  return true;
}
