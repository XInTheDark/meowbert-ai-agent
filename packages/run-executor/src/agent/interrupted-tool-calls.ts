import type { ResponseInputItem } from "openai/resources/responses/responses";
import { recordContextItems } from "../context-management-v2/window.js";
import type { ContextManagementState } from "../context-management-v2/types.js";
import type { RunToolCallStart } from "./ports/run-control.js";
import type { PreparedAgentRunContext } from "./runtime.js";

const MAX_NOTICE_ARGUMENT_CHARS = 500;

export function buildInterruptedToolCallNotice(calls: RunToolCallStart[]): string {
  const lines = calls.map((call) => {
    const args = call.arguments.length > MAX_NOTICE_ARGUMENT_CHARS
      ? `${call.arguments.slice(0, MAX_NOTICE_ARGUMENT_CHARS)}…`
      : call.arguments;
    return `- ${call.name} ${args}`;
  });
  return [
    "[System: The previous run was interrupted while these tool calls were running, so their outcome is unknown. Check their effects before repeating them.]",
    ...lines
  ].join("\n");
}

// Tells the agent about tool calls an earlier run left unfinished instead of letting it replay them
// blindly. Returns the branch leaf after the notice.
export async function reportInterruptedToolCalls(input: {
  prepared: PreparedAgentRunContext;
  contextManagement: ContextManagementState;
  conversationItems: ResponseInputItem[];
}): Promise<string | null> {
  const { prepared } = input;
  const calls = prepared.unfinishedToolCalls;
  if (calls.length === 0) {
    return prepared.currentLeafMessageId;
  }

  const { control } = prepared;
  const notice = buildInterruptedToolCallNotice(calls);
  const messageId = await control.appendMessage({
    role: "system",
    content: { kind: "interrupted_tool_calls", text: notice },
    parentMessageId: prepared.currentLeafMessageId
  });
  await control.selectBranch(messageId);
  const item: ResponseInputItem = { role: "system", content: notice };
  input.conversationItems.push(item);
  if (input.contextManagement.version === "v2") {
    await recordContextItems(control.context, input.contextManagement, [item]);
  }
  await control.resolveInterruptedToolCalls(calls.map((call) => call.callId));
  return messageId;
}
