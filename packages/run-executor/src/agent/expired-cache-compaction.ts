import type { ResponseInputItem } from "openai/resources/responses/responses";
import { resolveIdleCompactionForModel } from "@meowbert/shared";
import { selectRolloverSeedItems } from "../context-management-v2/rollover-seed.js";
import { estimateContextItemsTokens } from "../context-management-v2/token-estimation.js";
import { recordContextItems } from "../context-management-v2/window.js";
import { resetV2ContextWindow } from "./context-window.js";
import type { AgentExecutionContext } from "./execution-types.js";
import { isIdleCompactionRun } from "./idle-compaction.js";
import { appendRuntimeNotice } from "./runtime-notices.js";

// Enough to read and rewrite a few notes before the work carries on.
const NOTES_TURN_MAX_STEPS = 8;

const EXPIRED_CACHE_NOTE = "[System: " + [
  "A long pause let this conversation's prompt cache expire, so its context window will be cleared before you carry on.",
  "Your recent messages with the user will stay. Update the note continuity.md now with everything you need to continue the task, including results you have not acted on yet.",
  "Only the notes tools work for this turn."
].join(" ") + "]";

const RESUME_NOTICE = "[System: The context window was cleared after its prompt cache expired. Carry on with the task from your notes.]";

// A turn that may only read and write notes: idle compaction's, or the one before an expired window is cleared.
export function isNotesOnlyTurn(execution: AgentExecutionContext): boolean {
  return isIdleCompactionRun(execution.job) || Boolean(execution.state.expiredCacheNotesTurn);
}

function lastCacheReadAtMs(execution: AgentExecutionContext): number | null {
  if (execution.state.lastModelRequestStartedAtMs !== undefined) return execution.state.lastModelRequestStartedAtMs;
  const readAt = execution.prepared.snapshot.task.prompt_cache_read_at;
  const readAtMs = typeof readAt === "string" ? Date.parse(readAt) : Number.NaN;
  return Number.isFinite(readAtMs) ? readAtMs : null;
}

// With Full idle compaction, a request that would re-send a large conversation whose prompt cache has
// expired is sent to a fresh window instead. It costs about the same now and much less on every later turn.
export function shouldCompactExpiredCache(execution: AgentExecutionContext, nowMs: number): boolean {
  const { snapshot } = execution.prepared;
  if (snapshot.idle_compaction_mode !== "full" || execution.state.contextManagement.version !== "v2") return false;
  if (isNotesOnlyTurn(execution) || execution.laneSeed) return false;
  const readAtMs = lastCacheReadAtMs(execution);
  if (readAtMs === null) return false;
  const settings = resolveIdleCompactionForModel(execution.prepared.runtimeModel, snapshot.platform_model_metadata);
  if (!settings.enabled || nowMs < readAtMs + settings.promptCacheTtlSeconds * 1000) return false;
  return estimateContextItemsTokens(execution.state.dispatchState.conversationItems) >= settings.minTokens;
}

export async function beginExpiredCacheNotesTurn(execution: AgentExecutionContext): Promise<void> {
  const { dispatchState } = execution.state;
  const seedItems = selectRolloverSeedItems(dispatchState.conversationItems, { replies: false });
  const note: ResponseInputItem = { role: "user", content: EXPIRED_CACHE_NOTE };
  dispatchState.conversationItems.push(note);
  dispatchState.runPersistedItems.push(note);
  execution.state.expiredCacheNotesTurn = { note, seedItems, stepsTaken: 0 };
  execution.maxRunSteps += NOTES_TURN_MAX_STEPS;
  await execution.prepared.control.emitEvent("log", {
    message: "The prompt cache expired, so the agent is saving notes before its context window is cleared.",
    trigger: "cache_expired",
    contextManagementVersion: "v2"
  });
}

// Keep going during notes activity, then clear the window and release the unused checkpoint allowance.
export async function continueExpiredCacheNotesTurn(execution: AgentExecutionContext, wroteNotes: boolean): Promise<void> {
  const turn = execution.state.expiredCacheNotesTurn;
  if (!turn) return;
  const { dispatchState } = execution.state;
  dispatchState.pendingContextEdits = [];
  dispatchState.pendingContextV2Reset = false;
  turn.stepsTaken += 1;
  if (wroteNotes && turn.stepsTaken < NOTES_TURN_MAX_STEPS) return;

  execution.state.expiredCacheNotesTurn = null;
  if (execution.state.contextManagement.version === "v2") {
    await recordContextItems(execution.prepared.control.context, execution.state.contextManagement, [turn.note]);
  }
  await resetV2ContextWindow(execution, "cache_expired", turn.seedItems);
  appendRuntimeNotice(execution, { role: "user", content: RESUME_NOTICE });
  execution.maxRunSteps -= NOTES_TURN_MAX_STEPS - turn.stepsTaken;
  await execution.prepared.control.emitEvent("log", {
    message: "Context window cleared after its prompt cache expired.",
    trigger: "cache_expired",
    contextManagementVersion: "v2"
  });
}
