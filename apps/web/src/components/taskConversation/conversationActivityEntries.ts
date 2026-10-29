import type { ReactNode } from "react";
import type { TaskMessage } from "../../lib/types";
import { getResponseThoughtSummaries } from "../../task/responseThoughtSummaries";
import { getResponseToolMessages } from "../../task/responseToolMessages";
import { getModelRetryMessageDetails } from "../../task/taskConversationDisplay";
import { getTaskInlineArtifact, type TaskInlineArtifact } from "../../task/taskInlineArtifacts";
import { getManagedTaskCard, getRunInboxReportCards, type ManagedTaskCardData } from "../../task/managedTaskCards";
import { getInlineArtifactIdentity, getInlineResponseArtifactIdentities, getInlineResponseSegments, getTaskInlineArtifactMessageIdentity } from "../../task/inlineResponseSegments";
import { advanceActivityTurnState, EMPTY_ACTIVITY_TURN_STATE, type ActivityTurnState } from "../../task/activityTurnState";
import { collectHistoricalToolCallIds, getThoughtSummaryLabel, getToolMessageCallId, isResponseToolRepresentedInHistory } from "./shared";

export interface ActivityThought {
  id: string;
  label: string;
  content: string;
  nextCallIds: string[];
}

export interface ConversationActivityGroup {
  kind: "activity";
  key: string;
  startIndex: number;
  messageIds: string[];
  toolGroup: TaskMessage[];
  notices: TaskMessage[];
  thoughts: ActivityThought[];
  // The turn's progress and marked artifacts up to the end of this group.
  turnState: ActivityTurnState;
}

export type ConversationDisplayEntry = ConversationActivityGroup | {
  kind: "message";
  key: string;
  message: TaskMessage;
  contentOverride?: string;
  showActions: boolean;
} | {
  kind: "artifact";
  key: string;
  artifact: TaskInlineArtifact;
} | {
  kind: "managed-task";
  key: string;
  card: ManagedTaskCardData;
} | {
  // Content the page places after a message, such as an Agent Swarm's lane tracks.
  kind: "accessory";
  key: string;
  node: ReactNode;
};

function getManagedTaskEntries(tools: TaskMessage[]): ConversationDisplayEntry[] {
  return tools.flatMap((tool) => {
    const card = getManagedTaskCard(tool);
    return card ? [{ kind: "managed-task" as const, key: `managed-task:${tool.id}`, card }] : [];
  });
}

export function isActivityNotice(message: TaskMessage): boolean {
  if (message.role !== "system") {
    return false;
  }
  const text = typeof message.content_json.text === "string" ? message.content_json.text : "";
  return getModelRetryMessageDetails(message) !== null
    || text.startsWith("[System: Recovered missing tool output for function call ")
    || text.startsWith("[System: A recent request item was removed after repeated model-request errors.]")
    || text.startsWith("Task run failed (attempt ");
}

function getMessageDisplayEntries(message: TaskMessage): ConversationDisplayEntry[] {
  // A thread's note to the model about what context it was given; not part of the conversation.
  if (message.role === "system" && message.content_json.kind === "thread_context") {
    return [];
  }
  const reportCards = getRunInboxReportCards(message);
  if (reportCards) {
    return reportCards.map((card, index) => ({ kind: "managed-task" as const, key: `managed-task-report:${message.id}:${index}`, card }));
  }
  const segments = getInlineResponseSegments(message);
  if (segments.length > 0) {
    const lastText = segments.map((segment) => segment.kind).lastIndexOf("text");
    return segments.map((segment, index) => segment.kind === "artifact"
      ? { kind: "artifact", key: segment.id, artifact: segment.artifact }
      : { kind: "message", key: segment.id, message, contentOverride: segment.text, showActions: index === lastText });
  }
  if (message.role === "assistant" && !(typeof message.content_json.text === "string" && message.content_json.text.trim())) {
    return [];
  }
  return [{ kind: "message", key: message.id, message, showActions: true }];
}

function getUnrepresentedArtifacts(toolGroup: TaskMessage[], followingMessage?: TaskMessage): ConversationDisplayEntry[] {
  const representedIds = followingMessage ? getInlineResponseArtifactIdentities(followingMessage) : new Set<string>();
  return toolGroup.flatMap((message) => {
    const artifact = getTaskInlineArtifact(message);
    const identity = getTaskInlineArtifactMessageIdentity(message);
    return artifact && identity && !representedIds.has(identity)
      ? [{ kind: "artifact" as const, key: message.id, artifact }]
      : [];
  });
}

function getLatestResponseTools(messages: TaskMessage[]): Map<string, TaskMessage> {
  const latest = new Map<string, TaskMessage>();
  for (const tool of messages.flatMap(getResponseToolMessages)) {
    const callId = getToolMessageCallId(tool);
    if (callId) {
      latest.set(callId, tool);
    }
  }
  return latest;
}

export function buildConversationDisplayEntries(messages: TaskMessage[]): ConversationDisplayEntry[] {
  const entries: ConversationDisplayEntry[] = [];
  const historicalCallIds = collectHistoricalToolCallIds(messages);
  const seenResponseCallIds = new Set<string>();
  const latestResponseTools = getLatestResponseTools(messages);
  let pending: ConversationActivityGroup | null = null;
  const flush = (): void => {
    if (pending) entries.push(pending);
    pending = null;
  };
  const activity = (message: TaskMessage, index: number): ConversationActivityGroup => {
    pending ??= {
      kind: "activity", key: message.role === "tool" ? `tool-group:${message.id}` : `${message.id}:response-tools`,
      startIndex: index, messageIds: [], toolGroup: [], notices: [], thoughts: [],
      turnState: EMPTY_ACTIVITY_TURN_STATE
    };
    if (!pending.messageIds.includes(message.id)) pending.messageIds.push(message.id);
    return pending;
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (isActivityNotice(message)) {
      activity(message, index).notices.push(message);
      continue;
    }
    if (message.role === "tool") {
      const tools = [message];
      while (messages[index + 1]?.role === "tool") tools.push(messages[++index]);
      tools.forEach((tool, offset) => {
        const managedTask = getManagedTaskEntries([tool]);
        if (managedTask.length > 0) {
          flush();
          entries.push(...managedTask);
          return;
        }
        if (!getTaskInlineArtifact(tool)) {
          activity(tool, index - tools.length + 1 + offset).toolGroup.push(tool);
          return;
        }
        const artifacts = getUnrepresentedArtifacts([tool], messages[index + 1]);
        if (artifacts.length > 0) {
          flush();
          entries.push(...artifacts);
        }
      });
      continue;
    }
    const responseTools = getResponseToolMessages(message).filter((tool) => {
      const callId = getToolMessageCallId(tool);
      if (isResponseToolRepresentedInHistory(tool, historicalCallIds) || (callId && seenResponseCallIds.has(callId))) return false;
      if (callId) seenResponseCallIds.add(callId);
      return true;
    }).map((tool) => {
      const latest = latestResponseTools.get(getToolMessageCallId(tool) ?? "");
      return latest && !getTaskInlineArtifact(latest) ? { ...tool, content_json: latest.content_json } : tool;
    });
    const managedTaskEntries = getManagedTaskEntries(responseTools);
    const tools = responseTools.filter((tool) => !getTaskInlineArtifact(tool) && !getManagedTaskCard(tool));
    if (tools.length > 0) activity(message, index).toolGroup.push(...tools);
    const thoughts = getResponseThoughtSummaries(message);
    if (thoughts.length > 0) {
      const label = getThoughtSummaryLabel(message, messages[index - 1]);
      activity(message, index).thoughts.push(...thoughts.map((thought) => ({
        id: thought.id, label, content: thought.text, nextCallIds: thought.nextCallIds
      })));
    }
    const visibleEntries = getMessageDisplayEntries(message);
    const hasInlineArtifacts = visibleEntries.some((entry) => entry.kind === "artifact");
    const artifacts = hasInlineArtifacts ? [] : getUnrepresentedArtifacts(responseTools);
    if (visibleEntries.length > 0 || artifacts.length > 0 || managedTaskEntries.length > 0) {
      flush();
      entries.push(...managedTaskEntries, ...artifacts, ...visibleEntries);
    }
  }
  flush();
  return withActivityTurnState(withoutSupersededArtifacts(entries));
}

function withActivityTurnState(entries: ConversationDisplayEntry[]): ConversationDisplayEntry[] {
  let turnState = EMPTY_ACTIVITY_TURN_STATE;
  return entries.map((entry) => {
    if (entry.kind === "message" && entry.message.role === "user") {
      turnState = EMPTY_ACTIVITY_TURN_STATE;
    } else if (entry.kind === "activity") {
      turnState = advanceActivityTurnState(turnState, entry.toolGroup);
      return { ...entry, turnState };
    }
    return entry;
  });
}

// Showing the same file again in one turn (after fixing it) renders the live file, so the earlier
// card is a duplicate of the later one.
function withoutSupersededArtifacts(entries: ConversationDisplayEntry[]): ConversationDisplayEntry[] {
  const seen = new Set<string>();
  const kept: ConversationDisplayEntry[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind === "message" && entry.message.role === "user") {
      seen.clear();
    } else if (entry.kind === "artifact") {
      const identity = `${entry.artifact.display ?? ""}:${getInlineArtifactIdentity(entry.artifact)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
    }
    kept.push(entry);
  }
  return kept.reverse();
}

export function getConversationActivityGroups(messages: TaskMessage[]): ConversationActivityGroup[] {
  return buildConversationDisplayEntries(messages).filter((entry): entry is ConversationActivityGroup => entry.kind === "activity");
}
