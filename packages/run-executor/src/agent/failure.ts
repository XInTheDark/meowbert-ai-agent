import { readRetryAfterMs } from "@meowbert/shared";
import type { AgentFailureContext } from "./execution-types.js";
import { countPreservedReasoningContentItems } from "./reasoning-content-count.js";

// The control plane settles the failed run: cancellation, a retry, or a failed task.
export async function handleAgentRunFailure(execution: AgentFailureContext, error: unknown): Promise<void> {
  const { prepared } = execution;
  const retryAfterMs = readRetryAfterMs(error);
  await prepared.control.fail({
    errorMessage: error instanceof Error ? error.message : String(error),
    ...(retryAfterMs !== null ? { retryAfterMs } : {}),
    persistedItems: prepared.runPersistedItems,
    currentLeafMessageId: execution.state.currentLeafMessageId,
    agentId: prepared.runtimeAgentId,
    reasoningContentCount: countPreservedReasoningContentItems(prepared.runPersistedItems)
  });
}
