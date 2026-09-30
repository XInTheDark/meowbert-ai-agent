import type { ResponseInputItem } from "openai/resources/responses/responses";
import { appendMessage } from "../agent-db/index.js";

export const CONTEXT_CHECKPOINT_MARKER_KIND = "context_checkpoint";

interface CompleteToolGroup {
  callId: string;
  callType: string;
  outputType: string;
}

function asItemRecord(item: ResponseInputItem): Record<string, unknown> {
  return item as unknown as Record<string, unknown>;
}

function getToolCallPair(item: ResponseInputItem): CompleteToolGroup | null {
  const record = asItemRecord(item);
  if (typeof record.type !== "string" || typeof record.call_id !== "string") {
    return null;
  }

  const outputTypeByCallType: Record<string, string> = {
    function_call: "function_call_output",
    custom_tool_call: "custom_tool_call_output",
    apply_patch_call: "apply_patch_call_output",
    computer_call: "computer_call_output",
    local_shell_call: "local_shell_call_output"
  };
  const outputType = outputTypeByCallType[record.type];
  if (!outputType) {
    return null;
  }

  return {
    callId: record.call_id,
    callType: record.type,
    outputType
  };
}

function hasPairedOutput(items: ResponseInputItem[], group: CompleteToolGroup): boolean {
  return items.some((item) => {
    const record = asItemRecord(item);
    return record.type === group.outputType && record.call_id === group.callId;
  });
}

function getOldestCompleteToolGroups(
  items: ResponseInputItem[],
  excludedCallId: string
): CompleteToolGroup[] {
  const groups: CompleteToolGroup[] = [];
  for (const item of items) {
    const group = getToolCallPair(item);
    if (!group || group.callId === excludedCallId || !hasPairedOutput(items, group)) {
      continue;
    }
    groups.push(group);
  }
  return groups;
}

export function assertContextTrimCountAvailable(input: {
  conversationItems: ResponseInputItem[];
  triggeringCallId: string;
  count: number;
}): void {
  const availableCount = getOldestCompleteToolGroups(
    input.conversationItems,
    input.triggeringCallId
  ).length;
  if (input.count > availableCount) {
    throw new Error(
      `Cannot trim ${input.count} tool calls; only ${availableCount} complete call/output pairs are available before this tool.`
    );
  }
}

function removeToolGroups(items: ResponseInputItem[], groups: CompleteToolGroup[]): ResponseInputItem[] {
  const groupKeys = new Set(groups.map((group) => `${group.callType}:${group.callId}`));
  const outputKeys = new Set(groups.map((group) => `${group.outputType}:${group.callId}`));

  return items.filter((item) => {
    const record = asItemRecord(item);
    if (typeof record.type !== "string" || typeof record.call_id !== "string") {
      return true;
    }
    const key = `${record.type}:${record.call_id}`;
    return !groupKeys.has(key) && !outputKeys.has(key);
  });
}

function buildCheckpointContextItem(input: {
  action: "compact" | "trim" | "clear";
  checkpoint: string;
  toolSummary?: string;
  trimmedToolCount?: number;
}): ResponseInputItem {
  const lines = [
    `[Context checkpoint after ${input.action === "compact" ? "compaction" : input.action === "clear" ? "manual clear" : "tool trimming"}]`,
    "",
    input.checkpoint
  ];
  if (input.toolSummary) {
    lines.push("", `Trimmed tool calls (${input.trimmedToolCount ?? 0})`, "", input.toolSummary);
  }
  return {
    role: "system",
    content: lines.join("\n")
  };
}

export async function persistContextCheckpoint(input: {
  taskId: string;
  action: "compact" | "trim" | "clear";
  checkpoint: string;
  conversationItems: ResponseInputItem[];
  runPersistedItems: ResponseInputItem[];
  getCurrentLeafMessageId: () => string | null;
  setCurrentLeafMessageId: (messageId: string) => void;
  toolSummary?: string;
  trimmedToolCount?: number;
}): Promise<void> {
  const checkpointItem = buildCheckpointContextItem(input);
  const nextItems = [...input.conversationItems, checkpointItem];
  const messageId = await appendMessage(
    input.taskId,
    "system",
    {
      kind: CONTEXT_CHECKPOINT_MARKER_KIND,
      action: input.action,
      checkpoint: input.checkpoint,
      ...(input.toolSummary ? { tool_summary: input.toolSummary } : {}),
      ...(input.trimmedToolCount !== undefined ? { trimmed_tool_count: input.trimmedToolCount } : {}),
      response_items: nextItems
    },
    { parentMessageId: input.getCurrentLeafMessageId() }
  );

  input.conversationItems.splice(0, input.conversationItems.length, ...nextItems);
  input.runPersistedItems.length = 0;
  input.setCurrentLeafMessageId(messageId);
}

export async function checkpointAndTrimContext(input: {
  taskId: string;
  checkpoint: string;
  toolSummary: string;
  count: number;
  triggeringCallId: string;
  conversationItems: ResponseInputItem[];
  runPersistedItems: ResponseInputItem[];
  getCurrentLeafMessageId: () => string | null;
  setCurrentLeafMessageId: (messageId: string) => void;
}): Promise<void> {
  const completeGroups = getOldestCompleteToolGroups(input.conversationItems, input.triggeringCallId);
  assertContextTrimCountAvailable(input);

  const selectedGroups = completeGroups.slice(0, input.count);
  const retainedItems = removeToolGroups(input.conversationItems, selectedGroups);
  await persistContextCheckpoint({
    taskId: input.taskId,
    action: "trim",
    checkpoint: input.checkpoint,
    toolSummary: input.toolSummary,
    trimmedToolCount: input.count,
    conversationItems: retainedItems,
    runPersistedItems: input.runPersistedItems,
    getCurrentLeafMessageId: input.getCurrentLeafMessageId,
    setCurrentLeafMessageId: input.setCurrentLeafMessageId
  });
  input.conversationItems.splice(0, input.conversationItems.length, ...retainedItems);
}
