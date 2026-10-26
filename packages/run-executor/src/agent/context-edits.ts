import { collectCallNumbers, segmentConversationTurns } from "../context-management-v2/call-numbers.js";
import { applyContextEdits, buildContextEditItem } from "../context-management-v2/context-edits.js";
import { estimateContextItemsTokens } from "../context-management-v2/token-estimation.js";
import { recordContextItems } from "../context-management-v2/window.js";
import type { AgentExecutionContext } from "./execution-types.js";

// Applies the context edits requested in the turn that just ran. The requesting turn is the latest
// one; its calls are folded into the last summary so the summary text is not in context twice.
export async function applyPendingContextEdits(execution: AgentExecutionContext): Promise<boolean> {
  const state = execution.state.dispatchState;
  const context = execution.state.contextManagement;
  const edits = state.pendingContextEdits ?? [];
  state.pendingContextEdits = [];
  if (edits.length === 0 || context.version !== "v2") return false;

  const items = state.conversationItems;
  const turns = segmentConversationTurns(items, collectCallNumbers(items, state.callNumbers));
  const editedBy = (turns[turns.length - 1]?.calls ?? []).flatMap((call) => call.callNumber === null ? [] : [call.callNumber]);
  const editItems = edits.map((edit, index) => buildContextEditItem(items, edit, index === edits.length - 1 ? editedBy : null));
  const tokensBefore = estimateContextItemsTokens(items);

  // Summaries are stored without id markers: their content must stay plain JSON.
  await recordContextItems(execution.prepared.control.context, context, editItems, { preserveItems: true });
  state.runPersistedItems.push(...editItems);
  const edited = applyContextEdits([...items, ...editItems]);
  items.splice(0, items.length, ...edited);
  // The last provider usage still counts the replaced calls; estimate until the next response.
  if (state.contextWindowUsage) state.contextWindowUsage.lastResponseTotalTokens = null;

  await execution.prepared.control.emitEvent("log", {
    message: `Context edited: ${edits.map((edit) => `${edit.fromCallNumber}-${edit.toCallNumber}`).join(", ")} replaced with summaries.`,
    phase: "context_management",
    action: "replace_calls",
    estimatedTokensRemoved: Math.max(0, tokensBefore - estimateContextItemsTokens(edited))
  });
  return true;
}
