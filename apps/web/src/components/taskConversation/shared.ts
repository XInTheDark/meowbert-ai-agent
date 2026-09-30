import type { LiveToolCall, TaskMessage } from "../../lib/types";
import { getConversationActivityGroups } from "./conversationActivityEntries";
import type { ThoughtSummaryContentProps } from "./ThoughtSummaryBubble";

export type ToolInspectorSelection =
  | {
      kind: "historical";
      groupKey: string;
      toolGroup: TaskMessage[];
      thoughtSummary?: ThoughtSummaryContentProps;
      notices?: TaskMessage[];
      view?: "notices";
    }
  | {
      kind: "live";
      groupKey: string;
      liveToolCalls: LiveToolCall[];
    };

export function isCompactionMessage(content: Record<string, unknown>): boolean {
  return content.kind === "context_compaction";
}

export function isContextCheckpointMessage(content: Record<string, unknown>): boolean {
  return content.kind === "context_checkpoint";
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }

  return `${value}`;
}

function formatElapsedDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.max(1, Math.round(durationMs / 100)) / 10}s`;
  }

  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  return `${Math.round(durationMs / 1000)}s`;
}

export function getThoughtSummaryLabel(message: TaskMessage, previousMessage?: TaskMessage | null): string {
  const start = previousMessage ? new Date(previousMessage.created_at).getTime() : Number.NaN;
  const end = new Date(message.created_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return "Thought";
  }

  const durationMs = end - start;
  if (durationMs < 500 || durationMs > 12 * 60 * 60 * 1000) {
    return "Thought";
  }

  return `Thought for ${formatElapsedDuration(durationMs)}`;
}

function getToolGroupLabel(toolGroup: TaskMessage[]): string {
  if (toolGroup.length === 0) {
    return "Tool outputs";
  }

  if (toolGroup.length === 1) {
    const duration = toolGroup[0].content_json?.durationMs;
    if (typeof duration === "number") {
      return `Worked for ${(duration / 1000).toFixed(1)}s`;
    }

    return "Ran tool";
  }

  const first = toolGroup[0];
  const last = toolGroup[toolGroup.length - 1];
  const start = new Date(first.created_at).getTime();
  const end = new Date(last.created_at).getTime();
  const lastDuration = last.content_json?.durationMs;
  const hasExplicitDuration = typeof lastDuration === "number";
  const hasElapsedTime = Number.isFinite(start) && Number.isFinite(end) && end > start;

  if (!hasExplicitDuration && !hasElapsedTime) {
    return "Ran tools";
  }

  let totalDurationMs = end - start;
  if (hasExplicitDuration) {
    totalDurationMs += lastDuration;
  }
  if (totalDurationMs < 100) {
    totalDurationMs = 100;
  }

  return `Worked for ${(totalDurationMs / 1000).toFixed(1)}s`;
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatToolPreviewName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) {
    return "Tool";
  }

  if (normalized === "run_shell" || normalized === "shell" || normalized === "bash") {
    return "Shell";
  }
  if (normalized.includes("web") && normalized.includes("search")) {
    return "Web";
  }
  if (normalized.includes("memory") && normalized.includes("search")) {
    return "Memory";
  }
  if (normalized.includes("computer")) {
    return "Computer";
  }
  if (normalized.includes("subtask")) {
    return "Subtask";
  }
  if (normalized.includes("wait")) {
    return "Wait";
  }
  if (normalized.includes("file")) {
    return "Files";
  }

  return titleCaseWords(normalized.replace(/[_-]+/g, " "));
}

function getToolPreviewNameFromMessage(message: TaskMessage): string | null {
  const functionCall =
    message.content_json.response_function_call && typeof message.content_json.response_function_call === "object"
      ? (message.content_json.response_function_call as Record<string, unknown>)
      : null;
  const customToolCall =
    message.content_json.response_custom_tool_call && typeof message.content_json.response_custom_tool_call === "object"
      ? (message.content_json.response_custom_tool_call as Record<string, unknown>)
      : null;
  const webSearchCall =
    message.content_json.response_web_search_call && typeof message.content_json.response_web_search_call === "object"
      ? (message.content_json.response_web_search_call as Record<string, unknown>)
      : null;
  const functionName =
    (typeof functionCall?.name === "string" ? functionCall.name : null)
    ?? (typeof customToolCall?.name === "string" ? customToolCall.name : null)
    ?? (typeof message.content_json.tool === "string" ? message.content_json.tool : null);

  if (typeof webSearchCall?.id === "string" || typeof webSearchCall?.status === "string") {
    return "Web";
  }

  return functionName ? formatToolPreviewName(functionName) : null;
}

function buildPreviewLabel(names: string[]): string | null {
  if (names.length === 0) {
    return null;
  }

  const uniqueNames = Array.from(new Set(names));
  const visibleNames = uniqueNames.slice(0, 3);
  const extraCount = uniqueNames.length - visibleNames.length;
  const preview = visibleNames.join(" · ");
  return extraCount > 0 ? `${preview} +${extraCount}` : preview;
}

export function getToolGroupSummary(toolGroup: TaskMessage[]): {
  label: string;
  count: number;
  preview: string | null;
} {
  const previewNames = toolGroup
    .map((toolMessage) => getToolPreviewNameFromMessage(toolMessage))
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  return {
    label: getToolGroupLabel(toolGroup),
    count: toolGroup.length,
    preview: buildPreviewLabel(previewNames)
  };
}

export function getLiveToolCallsPreview(liveToolCalls: LiveToolCall[]): string | null {
  const previewNames = liveToolCalls
    .map((liveCall) => formatToolPreviewName(liveCall.toolName))
    .filter((value) => value.length > 0);

  return buildPreviewLabel(previewNames);
}

export function getHistoricalToolGroupKey(toolGroup: TaskMessage[]): string {
  return `tool-group:${toolGroup[0]?.id ?? "empty"}`;
}

export function getToolMessageCallId(message: TaskMessage): string | null {
  if (typeof message.content_json?.callId === "string" && message.content_json.callId.trim().length > 0) {
    return message.content_json.callId.trim();
  }

  const functionCall =
    message.content_json?.response_function_call && typeof message.content_json.response_function_call === "object"
      ? (message.content_json.response_function_call as Record<string, unknown>)
      : null;
  if (typeof functionCall?.call_id === "string" && functionCall.call_id.trim().length > 0) {
    return functionCall.call_id.trim();
  }

  const customCall =
    message.content_json?.response_custom_tool_call && typeof message.content_json.response_custom_tool_call === "object"
      ? (message.content_json.response_custom_tool_call as Record<string, unknown>)
      : null;
  if (typeof customCall?.call_id === "string" && customCall.call_id.trim().length > 0) {
    return customCall.call_id.trim();
  }

  const applyPatchCall =
    message.content_json?.response_apply_patch_call && typeof message.content_json.response_apply_patch_call === "object"
      ? (message.content_json.response_apply_patch_call as Record<string, unknown>)
      : null;
  if (typeof applyPatchCall?.call_id === "string" && applyPatchCall.call_id.trim().length > 0) {
    return applyPatchCall.call_id.trim();
  }

  const webSearchCall =
    message.content_json?.response_web_search_call && typeof message.content_json.response_web_search_call === "object"
      ? (message.content_json.response_web_search_call as Record<string, unknown>)
      : null;
  if (typeof webSearchCall?.id === "string" && webSearchCall.id.trim().length > 0) {
    return webSearchCall.id.trim();
  }

  return null;
}

export function isResponseToolRepresentedInHistory(
  toolMessage: TaskMessage,
  historicalToolCallIds: Set<string>
): boolean {
  const callId = getToolMessageCallId(toolMessage);
  return callId !== null && historicalToolCallIds.has(callId);
}

export function collectHistoricalToolCallIds(messages: TaskMessage[]): Set<string> {
  const historicalToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "tool") {
      const callId = getToolMessageCallId(msg);
      if (callId) {
        historicalToolCallIds.add(callId);
      }
    }
  }
  return historicalToolCallIds;
}

function findHistoricalActivityGroup(messages: TaskMessage[], groupKey: string, fallback: TaskMessage[] = []) {
  return getConversationActivityGroups(messages).find((group) => group.key === groupKey
    || group.messageIds.some((id) => groupKey === `tool-group:${id}` || groupKey === `${id}:response-tools`)
    || fallback.some((message) => group.messageIds.includes(message.id) || group.toolGroup.some((tool) => tool.id === message.id)));
}

export function findLatestHistoricalActivityToolGroup(
  messages: TaskMessage[]
): { groupKey: string; toolGroup: TaskMessage[] } | null {
  const groups = getConversationActivityGroups(messages).filter((group) => group.toolGroup.length > 0);
  const latest = groups[groups.length - 1];
  return latest ? { groupKey: latest.key, toolGroup: latest.toolGroup } : null;
}

export function resolveHistoricalToolGroupMessages(
  messages: TaskMessage[],
  groupKey: string,
  fallbackToolGroup: TaskMessage[]
): TaskMessage[] {
  const resolvedToolGroup = findHistoricalActivityGroup(messages, groupKey, fallbackToolGroup)?.toolGroup;
  if (resolvedToolGroup) {
    return resolvedToolGroup;
  }

  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const snapshotMessagesById = new Map(fallbackToolGroup.map((message) => [message.id, message]));
  const toolGroup = fallbackToolGroup
    .map((message) => messagesById.get(message.id) ?? snapshotMessagesById.get(message.id))
    .filter((message): message is TaskMessage => Boolean(message));

  return toolGroup.length > 0 ? toolGroup : fallbackToolGroup;
}

export function resolveToolInspectorSelection(
  selection: ToolInspectorSelection | null,
  messages: TaskMessage[],
  liveToolCalls: LiveToolCall[]
): ToolInspectorSelection | null {
  if (!selection) {
    return null;
  }

  if (selection.kind === "live") {
    if (liveToolCalls.length > 0) {
      return {
        ...selection,
        liveToolCalls
      };
    }

    const latestHistorical = findLatestHistoricalActivityToolGroup(messages);
    if (latestHistorical) {
      return {
        kind: "historical",
        groupKey: latestHistorical.groupKey,
        toolGroup: latestHistorical.toolGroup
      };
    }

    return null;
  }

  const group = findHistoricalActivityGroup(messages, selection.groupKey, selection.view === "notices" ? selection.notices : selection.toolGroup);
  return {
    ...selection,
    toolGroup: group?.toolGroup ?? resolveHistoricalToolGroupMessages(messages, selection.groupKey, selection.toolGroup),
    notices: group?.notices ?? selection.notices,
    thoughtSummary: selection.thoughtSummary && group?.thoughts.length ? {
      ...selection.thoughtSummary,
      label: group.thoughts.length === 1 ? group.thoughts[0].label : "Thought",
      content: group.thoughts.map((thought) => thought.content).join("\n\n")
    } : selection.thoughtSummary
  };
}

export interface StableToolGroupDescriptor {
  key: string;
  messageIds: string[];
  startIndex: number;
}

interface BuildStableToolGroupDescriptorsResult {
  descriptors: StableToolGroupDescriptor[];
  nextCounter: number;
}

export function buildStableHistoricalToolGroupDescriptors(
  messages: TaskMessage[],
  previousDescriptors: StableToolGroupDescriptor[],
  nextCounterSeed: number
): BuildStableToolGroupDescriptorsResult {
  const currentGroups = getConversationActivityGroups(messages);

  let nextCounter = nextCounterSeed;
  const usedPreviousDescriptorIndexes = new Set<number>();
  const descriptors = currentGroups.map((group) => {
    const groupMessageIdSet = new Set(group.messageIds);
    let matchedDescriptorIndex = -1;
    let matchedDescriptorOverlap = 0;

    for (let descriptorIndex = 0; descriptorIndex < previousDescriptors.length; descriptorIndex += 1) {
      if (usedPreviousDescriptorIndexes.has(descriptorIndex)) {
        continue;
      }

      const descriptor = previousDescriptors[descriptorIndex];
      let overlap = 0;
      for (const messageId of descriptor.messageIds) {
        if (groupMessageIdSet.has(messageId)) {
          overlap += 1;
        }
      }

      if (overlap > matchedDescriptorOverlap) {
        matchedDescriptorIndex = descriptorIndex;
        matchedDescriptorOverlap = overlap;
      }
    }

    if (matchedDescriptorIndex >= 0) {
      usedPreviousDescriptorIndexes.add(matchedDescriptorIndex);
      return {
        key: previousDescriptors[matchedDescriptorIndex].key,
        messageIds: group.messageIds,
        startIndex: group.startIndex
      };
    }

    const firstMessageId = group.messageIds[0];
    if (firstMessageId) {
      return {
        key: group.key,
        messageIds: group.messageIds,
        startIndex: group.startIndex
      };
    }

    const generatedKey = `tool-group:generated-${nextCounter}`;
    nextCounter += 1;
    return {
      key: generatedKey,
      messageIds: group.messageIds,
      startIndex: group.startIndex
    };
  });

  return { descriptors, nextCounter };
}

export function getToolMessageDisclosureKey(message: TaskMessage): string {
  return `tool-message:${message.id}`;
}

export function getLiveToolDisclosureKey(liveCall: LiveToolCall): string {
  return `live-tool:${liveCall.callId ?? liveCall.id}`;
}
