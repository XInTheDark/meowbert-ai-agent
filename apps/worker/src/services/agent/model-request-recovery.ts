import type { ResponseInputItem } from "openai/resources/responses/responses";
import { appendMessage } from "../agent-db/index.js";
import { collectTaskToolOutputItems, reconstructResponseInputItems } from "./utils.js";
import type { TaskMessageRow } from "./types.js";

const RECOVERY_NOTICE_PREFIX = "[System: Recent request history was trimmed after a model-request error.]";
const LEGACY_RECOVERY_NOTICE_PREFIX = "[System: A recent request item was removed after repeated model-request errors.]";
import {
  parseMissingToolOutput,
  parseMissingToolOutputCallId,
  type MissingToolOutputCallKind
} from "./model-error-actions.js";

export { parseMissingToolOutput, parseMissingToolOutputCallId };

export function buildMissingToolOutputItem(
  callId: string,
  kind: MissingToolOutputCallKind = "function_call"
): ResponseInputItem {
  if (kind === "custom_tool_call") {
    return {
      type: "custom_tool_call_output",
      call_id: callId,
      output: "system: an error occurred"
    } as ResponseInputItem;
  }

  if (kind === "apply_patch_call") {
    return {
      type: "apply_patch_call_output",
      call_id: callId,
      status: "failed",
      output: "system: an error occurred"
    } as ResponseInputItem;
  }

  return {
    type: "function_call_output",
    call_id: callId,
    output: "system: an error occurred"
  };
}

function isMatchingToolCall(item: ResponseInputItem, callId: string): boolean {
  if (typeof item !== "object" || item === null || !("call_id" in item)) {
    return false;
  }

  const typed = item as unknown as Record<string, unknown>;
  if (typeof typed.call_id !== "string" || (typed.call_id !== callId && typed.id !== callId)) {
    return false;
  }

  return getToolCallKind(item) !== null;
}

function getToolCallKind(item: ResponseInputItem): MissingToolOutputCallKind | null {
  if (typeof item !== "object" || item === null || !("type" in item)) {
    return null;
  }

  if (item.type === "custom_tool_call") {
    return "custom_tool_call";
  }
  if (item.type === "function_call") {
    return "function_call";
  }
  if (item.type === "apply_patch_call") {
    return "apply_patch_call";
  }
  return null;
}

function isMatchingToolOutput(item: ResponseInputItem, callId: string): boolean {
  if (typeof item !== "object" || item === null || !("call_id" in item)) {
    return false;
  }

  const typed = item as unknown as Record<string, unknown>;
  return typed.call_id === callId && typeof typed.type === "string" && typed.type.endsWith("_output");
}

export function insertMissingToolOutputItem(input: {
  conversationItems: ResponseInputItem[];
  callId: string;
}): ResponseInputItem[] | null {
  const callItem = input.conversationItems.find(
    (item) => isMatchingToolCall(item, input.callId)
  );
  if (!callItem || !("call_id" in callItem) || typeof callItem.call_id !== "string") {
    return null;
  }

  const actualCallId = callItem.call_id;
  const itemsWithoutOldOutput = input.conversationItems.filter(
    (item) => !isMatchingToolOutput(item, actualCallId)
  );
  const callIndex = itemsWithoutOldOutput.indexOf(callItem);
  const callKind = getToolCallKind(callItem);
  if (!callKind) {
    return null;
  }
  const outputItem = buildMissingToolOutputItem(actualCallId, callKind);

  const nextItems = [...itemsWithoutOldOutput];
  nextItems.splice(callIndex + 1, 0, outputItem);

  return nextItems;
}

function isRecoveryNotice(item: ResponseInputItem): boolean {
  if (typeof item !== "object" || item === null || !("role" in item) || !("content" in item)) {
    return false;
  }

  return item.role === "system"
    && typeof item.content === "string"
    && (item.content.startsWith(RECOVERY_NOTICE_PREFIX) || item.content.startsWith(LEGACY_RECOVERY_NOTICE_PREFIX));
}

function buildRecoveryNotice(errorMessage: string): ResponseInputItem {
  return {
    role: "system",
    content: `${RECOVERY_NOTICE_PREFIX}\nProvider error: ${errorMessage}`
  };
}

function trimReportedToolCall(items: ResponseInputItem[], callId: string, errorMessage: string): ResponseInputItem[] {
  return [
    ...items.filter((item) => !isMatchingToolCall(item, callId) && !isMatchingToolOutput(item, callId)),
    buildRecoveryNotice(errorMessage)
  ];
}

function findLastRecoverableItemIndex(items: ResponseInputItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!isRecoveryNotice(items[index])) {
      return index;
    }
  }

  return -1;
}

function findPairedToolCallIndex(items: ResponseInputItem[], outputIndex: number): number {
  const output = items[outputIndex] as { type?: string; call_id?: unknown };
  const callKind = output.type === "function_call_output" ? "function_call"
    : output.type === "custom_tool_call_output" ? "custom_tool_call"
      : output.type === "apply_patch_call_output" ? "apply_patch_call" : null;
  if (!callKind || typeof output.call_id !== "string") {
    return -1;
  }

  for (let index = outputIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (getToolCallKind(item) === callKind && "call_id" in item && item.call_id === output.call_id) {
      return index;
    }
  }

  return -1;
}

export function replaceLastRecoverableRequestItem(input: {
  conversationItems: ResponseInputItem[];
  errorMessage: string;
  repairMissingOutput?: boolean;
}): ResponseInputItem[] | null {
  const missingToolOutput = parseMissingToolOutput(input.errorMessage);
  if (missingToolOutput && input.repairMissingOutput !== false) {
    const repairedItems = insertMissingToolOutputItem({
      conversationItems: input.conversationItems,
      callId: missingToolOutput.callId
    });
    if (repairedItems) {
      return repairedItems;
    }
  }

  const itemIndex = findLastRecoverableItemIndex(input.conversationItems);
  if (itemIndex < 0) {
    return null;
  }

  const nextItems = [...input.conversationItems];
  nextItems[itemIndex] = buildRecoveryNotice(input.errorMessage);
  if (missingToolOutput) {
    const pairedCallIndex = findPairedToolCallIndex(input.conversationItems, itemIndex);
    if (pairedCallIndex >= 0) {
      nextItems.splice(pairedCallIndex, 1);
    }
  }
  return nextItems;
}

export async function persistModelRequestRecovery(input: {
  taskId: string;
  errorMessage: string;
  conversationItems: ResponseInputItem[];
  runPersistedItems: ResponseInputItem[];
  historicalMessages?: TaskMessageRow[];
  getCurrentLeafMessageId: () => string | null;
  setCurrentLeafMessageId: (messageId: string) => void;
}): Promise<boolean> {
  const missingToolOutput = parseMissingToolOutput(input.errorMessage);
  const hasReportedCall = missingToolOutput && input.conversationItems.some(
    (item) => isMatchingToolCall(item, missingToolOutput.callId)
  );
  const rebuiltItems = hasReportedCall
    ? reconstructResponseInputItems(input.conversationItems, {
      fallbackItems: [
        ...input.runPersistedItems,
        ...collectTaskToolOutputItems(input.historicalMessages ?? [])
      ]
    })
    : null;
  const repairedToolOutput = rebuiltItems !== null
    && JSON.stringify(rebuiltItems) !== JSON.stringify(input.conversationItems);
  const nextItems = repairedToolOutput
    ? rebuiltItems
    : hasReportedCall && missingToolOutput
      ? trimReportedToolCall(input.conversationItems, missingToolOutput.callId, input.errorMessage)
    : replaceLastRecoverableRequestItem({ ...input, repairMissingOutput: false });
  if (!nextItems) {
    return false;
  }

  const recoveryNoticeText = repairedToolOutput && missingToolOutput
    ? `[System: Reconstructed tool output history for ${missingToolOutput.kind === "custom_tool_call" ? "custom tool" : missingToolOutput.kind === "apply_patch_call" ? "apply_patch" : "function"} call ${missingToolOutput.callId}.]`
    : `${RECOVERY_NOTICE_PREFIX}\nProvider error: ${input.errorMessage}`;

  const messageId = await appendMessage(input.taskId, "system", {
    kind: "context_recovery",
    text: recoveryNoticeText,
    response_items: nextItems
  }, {
    parentMessageId: input.getCurrentLeafMessageId()
  });

  input.conversationItems.splice(0, input.conversationItems.length, ...nextItems);
  input.runPersistedItems.length = 0;
  input.setCurrentLeafMessageId(messageId);
  return true;
}
