import { buildContextWindowGuidance } from "../context-management-v2/prompts.js";
import {
  buildV2WindowDeveloperItems,
  linkContextNodeToVisibleMessage,
  recordContextItems,
  startNewContextWindow
} from "../context-management-v2/window.js";
import { selectRolloverSeedItems } from "../context-management-v2/rollover-seed.js";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { AgentExecutionContext } from "./execution-types.js";
import { resetWindowRequestSetup } from "./window-request.js";
import { persistRuntimeNotices } from "./runtime-notices.js";

// Unless the caller chooses seeds, the new window keeps the user's recent messages: a forced rollover
// can arrive before the agent saved a note, and the current request must survive it.
export async function resetV2ContextWindow(
  execution: AgentExecutionContext,
  reason: string,
  seedItems: ResponseInputItem[] = selectRolloverSeedItems(execution.state.dispatchState.conversationItems, { replies: false })
): Promise<void> {
  const context = execution.state.contextManagement;
  if (context.version !== "v2") return;
  await persistRuntimeNotices(execution);
  const { control } = execution.prepared;
  const tokenEstimate = execution.state.dispatchState.contextUsage?.usedTokens ?? null;
  const persistedItems = [...execution.state.dispatchState.runPersistedItems];
  const checkpointMessageId = await control.appendMessage({
    role: "system",
    content: {
      kind: "context_checkpoint",
      action: "rollover",
      reason,
      checkpoint: `Context window rollover (${reason}). Conversation items archived to context history.`,
      ...(persistedItems.length > 0 ? { response_items: persistedItems } : {})
    },
    parentMessageId: execution.state.currentLeafMessageId
  });
  execution.state.currentLeafMessageId = checkpointMessageId;
  await control.selectBranch(checkpointMessageId);
  execution.state.dispatchState.runPersistedItems.length = 0;

  const next = await startNewContextWindow(control.context, {
    state: context,
    branchLeafMessageId: checkpointMessageId,
    reason
  });
  await linkContextNodeToVisibleMessage(control.context, {
    state: next,
    visibleMessageId: checkpointMessageId
  });
  execution.state.contextManagement = next;
  resetWindowRequestSetup(execution);
  execution.state.dispatchState.pendingContextV2Reset = false;
  const windowDeveloperItems = await buildV2WindowDeveloperItems(control.context, {
    state: next,
    agentName: execution.prepared.runtimeAgentId ?? "main"
  });
  execution.state.dispatchState.conversationItems.splice(
    0,
    execution.state.dispatchState.conversationItems.length,
    ...windowDeveloperItems,
    { role: "developer", content: buildContextWindowGuidance({ historySearch: execution.prepared.historySearchEnabled, historyFiles: execution.prepared.isProjectMaster !== true }) },
    ...seedItems
  );
  await recordContextItems(control.context, next, seedItems);
  execution.state.dispatchState.contextUsage = null;
  execution.state.dispatchState.contextWindowUsage = null;
  execution.state.lastActualContextUsage = null;
  execution.state.hasActualContextUsage = false;
  console.info("[context-management-v2]", JSON.stringify({
    version: "v2",
    rolloverReason: reason,
    itemCount: execution.state.dispatchState.conversationItems.length,
    tokenEstimate
  }));
}
