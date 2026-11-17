import type { ResponseInputItem } from "openai/resources/responses/responses";
import { recordContextItems } from "../context-management-v2/window.js";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { persistRuntimeNotices } from "../agent/runtime-notices.js";

// Messages from outside the run were stored on its branch (after its pending tool calls); the run now
// continues from them and the model sees their items at the end of the conversation.
// Notices already in the conversation were stored on the branch ahead of these messages, so they are
// recorded to the window first; otherwise the window's order differs from the seed rebuilt from the branch.
export async function applyRunInboxAppend(
  execution: AgentExecutionContext,
  append: { leafMessageId: string; items: ResponseInputItem[] }
): Promise<void> {
  const state = execution.state;
  state.currentLeafMessageId = append.leafMessageId;
  state.dispatchState.runPersistedItems.splice(0);
  if (state.contextManagement.version === "v2") {
    await persistRuntimeNotices(execution);
    await recordContextItems(execution.prepared.control.context, state.contextManagement, append.items);
  }
  state.dispatchState.conversationItems.push(...append.items);
}
