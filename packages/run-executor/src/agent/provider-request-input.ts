import type {
  ResponseInputItem,
  ResponseInputMessageContentList
} from "openai/resources/responses/responses";
import type { PlatformModelCompatibilityMode, PlatformModelType } from "@meowbert/shared";

type ToolCallKind = "function_call" | "custom_tool_call" | "apply_patch_call";
type ToolOutputKind = "function_call_output" | "custom_tool_call_output" | "apply_patch_call_output";

const TOOL_OUTPUT_BY_CALL_TYPE: Record<ToolCallKind, ToolOutputKind> = {
  function_call: "function_call_output",
  custom_tool_call: "custom_tool_call_output",
  apply_patch_call: "apply_patch_call_output"
};

function getItemType(item: ResponseInputItem): string | null {
  return typeof item === "object" && item !== null && "type" in item && typeof item.type === "string"
    ? item.type
    : null;
}

function getCallId(item: ResponseInputItem): string | null {
  if (typeof item !== "object" || item === null || !("call_id" in item)) {
    return null;
  }

  const callId = (item as { call_id?: unknown }).call_id;
  return typeof callId === "string" && callId.length > 0 ? callId : null;
}

function stringifyFunctionCallArguments(value: unknown): string {
  if (value === null || typeof value === "undefined") {
    return "{}";
  }

  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : "{}";
  } catch {
    return "{}";
  }
}

function normalizeFunctionCallArguments(items: ResponseInputItem[]): ResponseInputItem[] {
  let changed = false;
  const output = items.map((item) => {
    if (typeof item !== "object" || item === null || getItemType(item) !== "function_call") {
      return item;
    }

    const argumentsValue = (item as { arguments?: unknown }).arguments;
    if (typeof argumentsValue === "string") {
      return item;
    }

    changed = true;
    return {
      ...item,
      arguments: stringifyFunctionCallArguments(argumentsValue)
    } as ResponseInputItem;
  });

  return changed ? output : items;
}

function isToolCallItem(item: ResponseInputItem): item is ResponseInputItem & { type: ToolCallKind; call_id: string } {
  const type = getItemType(item);
  return (
    (type === "function_call" || type === "custom_tool_call" || type === "apply_patch_call")
    && getCallId(item) !== null
  );
}

function isMatchingToolOutput(item: ResponseInputItem, callType: ToolCallKind, callId: string): boolean {
  return getItemType(item) === TOOL_OUTPUT_BY_CALL_TYPE[callType] && getCallId(item) === callId;
}

function hasCompatibilityMode(
  compatibilityModes: readonly PlatformModelCompatibilityMode[],
  mode: PlatformModelCompatibilityMode
): boolean {
  return compatibilityModes.includes(mode);
}

function convertSystemMessagesToUserMessages(items: ResponseInputItem[]): ResponseInputItem[] {
  return items.map((item) => {
    if (typeof item !== "object" || item === null || !("role" in item)) {
      return item;
    }

    const role = (item as { role?: unknown }).role;
    if (role !== "system" && role !== "developer") {
      return item;
    }

    return {
      ...item,
      role: "user"
    } as ResponseInputItem;
  });
}

function convertDeveloperMessagesToSystemMessages(items: ResponseInputItem[]): ResponseInputItem[] {
  return items.map((item) => {
    if (typeof item !== "object" || item === null || !("role" in item)) {
      return item;
    }

    const role = (item as { role?: unknown }).role;
    if (role !== "developer") {
      return item;
    }

    return {
      ...item,
      role: "system"
    } as ResponseInputItem;
  });
}

type InstructionMessage = ResponseInputItem & {
  role: "system" | "developer";
  content: string | ResponseInputMessageContentList;
};

function isInstructionMessage(item: ResponseInputItem): item is InstructionMessage {
  if (typeof item !== "object" || item === null || !("role" in item) || !("content" in item)) {
    return false;
  }

  return item.role === "system" || item.role === "developer";
}

function mergeInstructionContent(messages: InstructionMessage[]): string | ResponseInputMessageContentList {
  if (messages.every((message) => typeof message.content === "string")) {
    return messages.map((message) => message.content).join("\n\n");
  }

  return messages.flatMap((message, index) => [
    ...(index > 0 ? [{ type: "input_text" as const, text: "\n\n" }] : []),
    ...(typeof message.content === "string"
      ? [{ type: "input_text" as const, text: message.content }]
      : message.content)
  ]);
}

function mergeGoogleInstructionMessages(items: ResponseInputItem[]): ResponseInputItem[] {
  const instructionMessages = items.filter(isInstructionMessage);
  if (instructionMessages.length === 0) {
    return items;
  }

  return [
    {
      role: "system",
      content: mergeInstructionContent(instructionMessages)
    },
    ...items.filter((item) => !isInstructionMessage(item))
  ];
}

function findMatchingToolOutputIndex(
  items: ResponseInputItem[],
  callType: ToolCallKind,
  callId: string,
  startIndex: number,
  consumedIndexes: Set<number>
): number | null {
  for (let index = startIndex; index < items.length; index += 1) {
    if (consumedIndexes.has(index)) {
      continue;
    }

    if (isMatchingToolOutput(items[index], callType, callId)) {
      return index;
    }
  }

  return null;
}

export function normalizeGoogleToolResultAdjacency(items: ResponseInputItem[]): ResponseInputItem[] {
  const output: ResponseInputItem[] = [];
  const consumedIndexes = new Set<number>();

  for (let index = 0; index < items.length; index += 1) {
    if (consumedIndexes.has(index)) {
      continue;
    }

    const item = items[index];
    output.push(item);

    if (!isToolCallItem(item)) {
      continue;
    }

    const callId = getCallId(item);
    if (!callId) {
      continue;
    }

    const nextItem = items[index + 1];
    if (nextItem && isMatchingToolOutput(nextItem, item.type, callId)) {
      continue;
    }

    const matchingOutputIndex = findMatchingToolOutputIndex(items, item.type, callId, index + 1, consumedIndexes);
    if (matchingOutputIndex === null) {
      continue;
    }

    output.push(items[matchingOutputIndex]);
    consumedIndexes.add(matchingOutputIndex);
  }

  return output;
}

export function normalizeProviderRequestInput(
  items: ResponseInputItem[],
  modelType: PlatformModelType,
  compatibilityModes: readonly PlatformModelCompatibilityMode[] = []
): ResponseInputItem[] {
  let compatibleItems = normalizeFunctionCallArguments(items);
  if (modelType === "google") {
    compatibleItems = mergeGoogleInstructionMessages(compatibleItems);
  } else if (hasCompatibilityMode(compatibilityModes, "noSystemMessages")) {
    compatibleItems = convertSystemMessagesToUserMessages(compatibleItems);
  } else if (hasCompatibilityMode(compatibilityModes, "noDeveloperMessages")) {
    compatibleItems = convertDeveloperMessagesToSystemMessages(compatibleItems);
  }

  if (modelType === "google") {
    return normalizeGoogleToolResultAdjacency(compatibleItems);
  }

  return compatibleItems;
}
