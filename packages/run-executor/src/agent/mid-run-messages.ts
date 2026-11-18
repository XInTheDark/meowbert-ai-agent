import type { AgentExecutionContext } from "./execution-types.js";
import { countPreservedReasoningContentItems } from "./reasoning-content-count.js";
import { adoptVisibleMessage } from "./visible-message.js";

const NOTIFICATION_PREVIEW_MAX_CHARS = 240;

function previewOf(text: string): string {
  return text.length > NOTIFICATION_PREVIEW_MAX_CHARS ? `${text.slice(0, NOTIFICATION_PREVIEW_MAX_CHARS)}…` : text;
}

// Posts this turn's send_message calls while the run keeps going. Each message takes the work done
// so far with it, so the conversation shows that work above the update.
export async function publishMidRunMessages(execution: AgentExecutionContext): Promise<void> {
  const { dispatchState } = execution.state;
  const messages = dispatchState.pendingMidRunMessages ?? [];
  dispatchState.pendingMidRunMessages = [];
  const { control, runPersistedItems, runtimeAgentId } = execution.prepared;
  for (const text of messages) {
    const responseItems = [...runPersistedItems];
    execution.state.currentLeafMessageId = await control.appendMessage({
      role: "assistant",
      content: { text, ...(responseItems.length > 0 ? { response_items: responseItems } : {}) },
      parentMessageId: execution.state.currentLeafMessageId,
      agentId: runtimeAgentId,
      reasoningContentCount: countPreservedReasoningContentItems(responseItems)
    });
    runPersistedItems.length = 0;
    await adoptVisibleMessage(execution);
    await control.emitEvent("notification", {
      channel: "web",
      status: "sent",
      runId: execution.job.runId,
      preview: previewOf(text)
    });
  }
}
