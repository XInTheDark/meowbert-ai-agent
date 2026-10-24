import type { ResponseInputItem, ResponseUsage } from "openai/resources/responses/responses";
import { calculateContextWindowTokenStatus, type ContextWindowBudget } from "./token-budget.js";
import { estimateContextItemsTokens, isModelGeneratedContextItem } from "./token-estimation.js";

export interface ContextWindowUsage {
  budget: ContextWindowBudget;
  prefixItems: ResponseInputItem[];
  lastResponseTotalTokens: number | null;
}

export function getResponseTotalTokens(usage: ResponseUsage | undefined): number | null {
  if (typeof usage?.input_tokens !== "number" || !Number.isFinite(usage.input_tokens)) return null;
  const total = typeof usage.total_tokens === "number" && Number.isFinite(usage.total_tokens)
    ? usage.total_tokens
    : usage.input_tokens + Math.max(0, usage.output_tokens ?? 0);
  return Math.max(0, Math.floor(total));
}

// Codex uses last-response total tokens plus local items after the latest model item.
// Before the first usable API sample, estimate the initial context instead.
export function getContextWindowTokenStatus(usage: ContextWindowUsage, items: ResponseInputItem[]) {
  let activeTokens: number;
  if (usage.lastResponseTotalTokens === null) {
    activeTokens = estimateContextItemsTokens(usage.prefixItems) + estimateContextItemsTokens(items);
  } else {
    let lastModelIndex = -1;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (isModelGeneratedContextItem(items[index])) {
        lastModelIndex = index;
        break;
      }
    }
    const tail = lastModelIndex < 0 ? [] : items.slice(lastModelIndex + 1);
    activeTokens = usage.lastResponseTotalTokens + estimateContextItemsTokens(tail);
  }
  return calculateContextWindowTokenStatus(usage.budget, activeTokens);
}
