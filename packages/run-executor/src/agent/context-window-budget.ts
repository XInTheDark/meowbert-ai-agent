import type { ResponseInputItem } from "openai/resources/responses/responses";
import { recordContextItems } from "../context-management-v2/window.js";
import { buildContextReminder, CONTEXT_EXHAUSTED_FALLBACK } from "../context-management-v2/prompts.js";
import { CONTEXT_REMINDER_THRESHOLD_TOKENS, resolveContextWindowBudget } from "../context-management-v2/token-budget.js";
import { getContextWindowTokenStatus } from "../context-management-v2/token-usage.js";
import { resetV2ContextWindow } from "./context-window.js";
import { promptEnvelopeToPrefixItems } from "./prompt-envelope.js";
import type { AgentExecutionContext } from "./execution-types.js";

export function prepareV2ContextWindowUsage(execution: AgentExecutionContext, prefixItems?: ResponseInputItem[]) {
  if (execution.state.contextManagement.version !== "v2") return null;
  const state = execution.state.dispatchState;
  const budget = resolveContextWindowBudget({
    contextWindow: execution.prepared.maxContextTokens,
    model: execution.prepared.runtimeModel,
    metadata: execution.prepared.snapshot.platform_model_metadata
  });
  state.contextWindowUsage ??= {
    budget,
    prefixItems: [],
    lastResponseTotalTokens: null
  };
  state.contextWindowUsage.budget = budget;
  state.contextWindowUsage.prefixItems = prefixItems ?? promptEnvelopeToPrefixItems(execution.promptEnvelope);
  return state.contextWindowUsage;
}

async function appendBudgetPrompt(execution: AgentExecutionContext, content: string): Promise<void> {
  const context = execution.state.contextManagement;
  if (context.version !== "v2") return;
  const item: ResponseInputItem = { role: "developer", content };
  await recordContextItems(execution.prepared.control.context, context, [item]);
  execution.state.dispatchState.conversationItems.push(item);
  execution.state.dispatchState.runPersistedItems.push(item);
}

export async function maybeAdvanceV2ContextWindow(execution: AgentExecutionContext): Promise<void> {
  const context = execution.state.contextManagement;
  const usage = prepareV2ContextWindowUsage(execution);
  if (context.version !== "v2" || !usage) return;
  const status = getContextWindowTokenStatus(usage, execution.state.dispatchState.conversationItems);
  if (status.limitReached) {
    await resetV2ContextWindow(execution, "automatic");
    return;
  }
  if (!context.reminderSent && status.tokensRemaining <= CONTEXT_REMINDER_THRESHOLD_TOKENS) {
    await appendBudgetPrompt(execution, buildContextReminder(status.tokensRemaining));
    context.reminderSent = true;
  }
  if (!context.fallbackSent && status.tokensRemaining === 0) {
    await appendBudgetPrompt(execution, CONTEXT_EXHAUSTED_FALLBACK);
    context.fallbackSent = true;
  }
}
