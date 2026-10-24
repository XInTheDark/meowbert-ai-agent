import type { ResponseInputItem } from "openai/resources/responses/responses";
import { prepareCompactedItems } from "../context-compaction/index.js";
import { buildCompactionRunFields } from "../agent/compaction-input.js";
import type { AgentExecutionContext } from "../agent/execution-types.js";

export type ForkCompactor = (items: ResponseInputItem[], requestItemCount: number) => Promise<ResponseInputItem[]>;

// Above the threshold, the lanes of one split fork from a single compacted copy, so they still share a
// cache with each other; the parent keeps its full context. The current response and the outputs
// already recorded for it stay verbatim, so the split call is still the last item each lane inherits.
export function buildForkCompactor(execution: AgentExecutionContext, step: () => number): ForkCompactor {
  return async (items, requestItemCount) => {
    const head = items.slice(0, requestItemCount);
    const tail = items.slice(requestItemCount);
    const compacted = await prepareCompactedItems({
      ...buildCompactionRunFields(execution, step(), execution.runTiming.runAbortSignal),
      trigger: "manual",
      conversationItems: head,
      runPersistedItems: []
    });
    return [...compacted, ...tail];
  };
}
