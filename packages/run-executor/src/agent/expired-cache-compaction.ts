import { resolveIdleCompactionForModel } from "@meowbert/shared";
import { estimateContextItemsTokens } from "../context-management-v2/token-estimation.js";
import { resetV2ContextWindow } from "./context-window.js";
import type { AgentExecutionContext } from "./execution-types.js";
import { isIdleCompactionRun } from "./idle-compaction.js";
import { appendRuntimeNotice } from "./runtime-notices.js";

const RESUME_NOTICE = "[System: The context window was cleared after a long pause let its prompt cache expire. Carry on from your notes; read the history for anything they do not cover.]";

// A turn that may only read and write notes: idle compaction's.
export function isNotesOnlyTurn(execution: AgentExecutionContext): boolean {
  return isIdleCompactionRun(execution.job);
}

function lastCacheReadAtMs(execution: AgentExecutionContext): number | null {
  if (execution.state.lastModelRequestStartedAtMs !== undefined) return execution.state.lastModelRequestStartedAtMs;
  const readAt = execution.prepared.snapshot.task.prompt_cache_read_at;
  const readAtMs = typeof readAt === "string" ? Date.parse(readAt) : Number.NaN;
  return Number.isFinite(readAtMs) ? readAtMs : null;
}

function measuredCacheTokens(execution: AgentExecutionContext): number {
  const fromRun = execution.state.lastActualContextUsage?.inputTokens;
  if (typeof fromRun === "number" && Number.isFinite(fromRun)) return fromRun;
  if (execution.state.lastModelRequestStartedAtMs === undefined) {
    const fromSnapshot = execution.prepared.snapshot.task.prompt_cache_used_tokens;
    if (typeof fromSnapshot === "number" && Number.isFinite(fromSnapshot)) return fromSnapshot;
  }
  return 0;
}

// With Full idle compaction, a request that would re-send a large conversation whose prompt cache has
// expired goes to a fresh window instead, so the expired conversation is never sent again.
// A freshly forked lane has no prior request of its own (`readAtMs === null`), so its seed stays intact.
export function shouldCompactExpiredCache(execution: AgentExecutionContext, nowMs: number): boolean {
  const { snapshot } = execution.prepared;
  if (snapshot.idle_compaction_mode !== "full" || execution.state.contextManagement.version !== "v2") return false;
  if (isNotesOnlyTurn(execution)) return false;
  const readAtMs = lastCacheReadAtMs(execution);
  if (readAtMs === null) return false;
  const settings = resolveIdleCompactionForModel(execution.prepared.runtimeModel, snapshot.platform_model_metadata);
  if (!settings.enabled || nowMs < readAtMs + settings.promptCacheTtlSeconds * 1000) return false;
  const tokens = Math.max(
    measuredCacheTokens(execution),
    estimateContextItemsTokens(execution.state.dispatchState.conversationItems)
  );
  return tokens >= settings.minTokens;
}

// The new window keeps the user's recent messages and any tool results the agent has not read yet;
// the rest stays in the notes and the history.
export async function clearExpiredCacheWindow(execution: AgentExecutionContext): Promise<void> {
  await resetV2ContextWindow(execution, "cache_expired");
  appendRuntimeNotice(execution, { role: "user", content: RESUME_NOTICE });
  await execution.prepared.control.emitEvent("log", {
    message: "Context window cleared after its prompt cache expired.",
    trigger: "cache_expired",
    contextManagementVersion: "v2"
  });
}
