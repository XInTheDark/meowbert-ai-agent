import { appendMessage, setTaskBranchSelection } from "../agent-db/index.js";
import {
  buildV2WindowDeveloperItems,
  CONTEXT_WINDOW_GUIDANCE,
  linkContextNodeToVisibleMessage,
  recordContextItems,
  startNewContextWindow
} from "../context-management-v2/index.js";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { AgentExecutionContext } from "./execution-types.js";

const MAX_CONTEXT_OVERFLOW_RECOVERY_CHARS = 16_000;
const OPAQUE_ITEM_MARKER = /\n\[id: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]$/i;
const INTERNAL_USER_NOTICE_PREFIXES = [
  "[System:",
  "Shell tool result:",
  "The timed task's deadline has been reached."
];

function isRecoverableUserItem(item: ResponseInputItem): boolean {
  if (!item || typeof item !== "object" || (item as { role?: unknown }).role !== "user") {
    return false;
  }
  const content = (item as { content?: unknown }).content;
  if (typeof content !== "string") return false;
  return !INTERNAL_USER_NOTICE_PREFIXES.some((prefix) => content.startsWith(prefix));
}

function boundRecoveryItem(item: ResponseInputItem): ResponseInputItem {
  const content = (item as { content?: unknown }).content;
  if (typeof content !== "string" || content.length <= MAX_CONTEXT_OVERFLOW_RECOVERY_CHARS) {
    return item;
  }

  const marker = content.match(OPAQUE_ITEM_MARKER)?.[0] ?? "";
  const truncationNotice = "\n[recovery excerpt truncated; use context history tools for the full request]";
  const availableChars = Math.max(
    0,
    MAX_CONTEXT_OVERFLOW_RECOVERY_CHARS - marker.length - truncationNotice.length
  );
  return {
    ...item,
    content: `${content.slice(0, availableChars)}${truncationNotice}${marker}`
  } as ResponseInputItem;
}

export function selectContextOverflowRecoveryItems(items: ResponseInputItem[]): ResponseInputItem[] {
  const latestUserItem = [...items].reverse().find(isRecoverableUserItem);
  return latestUserItem ? [boundRecoveryItem(latestUserItem)] : [];
}

export async function resetV2ContextWindow(
  execution: AgentExecutionContext,
  reason: string,
  seedItems: ResponseInputItem[] = []
): Promise<void> {
  const context = execution.state.contextManagement;
  if (context.version !== "v2") return;
  const tokenEstimate = execution.state.dispatchState.contextUsage?.usedTokens ?? null;
  const persistedItems = [...execution.state.dispatchState.runPersistedItems];
  const checkpointMessageId = await appendMessage(
    execution.job.taskId,
    "system",
    {
      kind: "context_checkpoint",
      action: "rollover",
      reason,
      checkpoint: `Context window rollover (${reason}). Conversation items archived to context history.`,
      ...(persistedItems.length > 0 ? { response_items: persistedItems } : {})
    },
    {
      parentMessageId: execution.state.currentLeafMessageId
    }
  );
  execution.state.currentLeafMessageId = checkpointMessageId;
  if (execution.job.selectionUserId) {
    await setTaskBranchSelection(execution.job.taskId, execution.job.selectionUserId, checkpointMessageId);
  }
  execution.state.dispatchState.runPersistedItems.length = 0;

  const next = await startNewContextWindow({
    state: context,
    branchLeafMessageId: checkpointMessageId,
    reason
  });
  await linkContextNodeToVisibleMessage({
    state: next,
    visibleMessageId: checkpointMessageId
  });
  execution.state.contextManagement = next;
  execution.state.dispatchState.pendingContextV2Reset = false;
  const windowDeveloperItems = await buildV2WindowDeveloperItems({
    state: next,
    agentName: execution.prepared.runtimeAgentId ?? "main"
  });
  execution.state.dispatchState.conversationItems.splice(
    0,
    execution.state.dispatchState.conversationItems.length,
    ...windowDeveloperItems,
    { role: "developer", content: CONTEXT_WINDOW_GUIDANCE },
    ...seedItems
  );
  await recordContextItems(next, seedItems);
  execution.state.dispatchState.contextUsage = null;
  execution.state.lastActualContextUsage = null;
  execution.state.hasActualContextUsage = false;
  console.info("[context-management-v2]", JSON.stringify({
    version: "v2",
    rolloverReason: reason,
    itemCount: execution.state.dispatchState.conversationItems.length,
    tokenEstimate
  }));
}
