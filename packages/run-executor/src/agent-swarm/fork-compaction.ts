import type { ResponseInputItem } from "openai/resources/responses/responses";
import { prepareCompactedItems } from "../context-compaction/index.js";
import { buildCompactionRunFields } from "../agent/compaction-input.js";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { summarizeFromParentTurn, type ParentTurnRequest } from "./fork-summary.js";

export type ForkCompactor = (items: ResponseInputItem[], requestItemCount: number) => Promise<ResponseInputItem[]>;

function isCancellation(execution: AgentExecutionContext, error: unknown): boolean {
  return execution.runTiming.runAbortSignal.aborted || (error instanceof Error && error.message === "TASK_CANCELLED");
}

// The handoff is asked of the parent's own conversation, so it reads the cache the parent's last
// request wrote. A standalone summary request re-sends the whole history uncached; it is the fallback.
async function summarizeWithParentCache(
  execution: AgentExecutionContext,
  parentRequest: ParentTurnRequest,
  head: ResponseInputItem[]
): Promise<ResponseInputItem[] | null> {
  try {
    const handoff = await summarizeFromParentTurn(parentRequest, head);
    return handoff ? [{ role: "system", content: `## Context Compaction\n\n${handoff}` }] : null;
  } catch (error) {
    if (isCancellation(execution, error)) throw error;
    await execution.prepared.control.emitEvent("log", {
      message: "Fork handoff from the parent's cached turn failed; summarizing the history instead.",
      phase: "fork_compaction",
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

// Above the threshold, the lanes of one split fork from a single compacted copy, so they still share a
// cache with each other; the parent keeps its full context. The current response and the outputs
// already recorded for it stay verbatim, so the split call is still the last item each lane inherits.
export function buildForkCompactor(
  execution: AgentExecutionContext,
  step: () => number,
  parentRequest: ParentTurnRequest
): ForkCompactor {
  return async (items, requestItemCount) => {
    const head = items.slice(0, requestItemCount);
    const tail = items.slice(requestItemCount);
    const summary = await summarizeWithParentCache(execution, parentRequest, head)
      ?? await prepareCompactedItems({
        ...buildCompactionRunFields(execution, step(), execution.runTiming.runAbortSignal),
        trigger: "manual",
        conversationItems: head,
        runPersistedItems: []
      });
    return [...summary, ...tail];
  };
}
