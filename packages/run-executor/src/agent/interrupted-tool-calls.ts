import type { ResponseInputItem } from "openai/resources/responses/responses";
import { buildMissingToolOutputItem } from "./model-request-recovery.js";
import { recordContextItems } from "../context-management-v2/window.js";
import type { ContextManagementState } from "../context-management-v2/types.js";
import type { RunToolCallStart } from "./ports/run-control.js";
import type { PreparedAgentRunContext } from "./runtime.js";

const MAX_NOTICE_ARGUMENT_CHARS = 500;

const INTERRUPTED_OUTPUT = JSON.stringify({ error: "The run was interrupted before this call finished, so its outcome is unknown." });

// Providers reject a call that has no output, so each interrupted call still in the history is
// answered in place of the result it never got.
function buildInterruptedCallOutputs(items: ResponseInputItem[], calls: RunToolCallStart[]): ResponseInputItem[] {
  const interrupted = new Set(calls.map((call) => call.callId));
  const answered = new Set(items.flatMap((item) => {
    const record = item as { type?: unknown; call_id?: unknown };
    return typeof record.type === "string" && record.type.endsWith("_call_output") && typeof record.call_id === "string"
      ? [record.call_id]
      : [];
  }));
  return items.flatMap((item) => {
    const record = item as { type?: unknown; call_id?: unknown };
    if (typeof record.call_id !== "string" || !interrupted.has(record.call_id) || answered.has(record.call_id)) return [];
    const kind = record.type === "function_call" || record.type === "custom_tool_call" || record.type === "apply_patch_call"
      ? record.type
      : null;
    if (!kind) return [];
    answered.add(record.call_id);
    return [buildMissingToolOutputItem(record.call_id, kind, INTERRUPTED_OUTPUT)];
  });
}

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
  const items: ResponseInputItem[] = [
    ...buildInterruptedCallOutputs(input.conversationItems, calls),
    { role: "system", content: notice }
  ];
  input.conversationItems.push(...items);
  if (input.contextManagement.version === "v2") {
    await recordContextItems(control.context, input.contextManagement, items);
  }
  await control.resolveInterruptedToolCalls(calls.map((call) => call.callId));
  return messageId;
}
