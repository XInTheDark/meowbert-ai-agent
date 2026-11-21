import type { TaskMessage } from "../../lib/types";
import { isActivityNotice, type ConversationDisplayEntry } from "./conversationActivityEntries";
import type { ConversationRenderItem } from "./conversationTurnFolds";
import { isCompactionMessage, isContextCheckpointMessage } from "./shared";

export interface TurnFallbackFooter {
  key: string;
  anchorMessage: TaskMessage;
  branchCandidates: TaskMessage[];
  isTrailingTurn: boolean;
}

export interface ConversationTurnFooterPlan {
  fallbackFootersBySpan: Map<number, TurnFallbackFooter>;
  extraBranchCandidatesByMessageId: Map<string, TaskMessage[]>;
}

interface NonUserMessageSpan {
  spanIndex: number;
  messages: TaskMessage[];
  isTrailingTurn: boolean;
}

function isStandaloneSystemCard(message: TaskMessage): boolean {
  if (message.role !== "system") return false;
  return message.content_json.kind === "thread_context"
    || message.content_json.kind === "force_include_issue"
    || isCompactionMessage(message.content_json)
    || isContextCheckpointMessage(message.content_json);
}

function collectRenderedBranchMessageIds(entries: ConversationDisplayEntry[]): Set<string> {
  const rendered = new Set<string>();
  for (const entry of entries) {
    if (entry.kind !== "message") continue;
    const { message } = entry;
    const isCardWithBranch = message.role === "system"
      && (isCompactionMessage(message.content_json) || isContextCheckpointMessage(message.content_json));
    const isStandardWithBranch = entry.showActions
      && !(message.role === "system" && message.content_json.kind === "force_include_issue");
    if (isCardWithBranch || isStandardWithBranch) {
      rendered.add(message.id);
    }
  }
  return rendered;
}

function splitNonUserSpans(messages: TaskMessage[]): NonUserMessageSpan[] {
  const spans: NonUserMessageSpan[] = [];
  let spanIndex = 0;
  let current: TaskMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      spans.push({ spanIndex, messages: current, isTrailingTurn: false });
      spanIndex += 1;
      current = [];
    } else {
      current.push(message);
    }
  }
  spans.push({ spanIndex, messages: current, isTrailingTurn: true });
  return spans;
}

function findLastVisibleAssistantMessageId(
  entries: ConversationDisplayEntry[],
  spanMessageIds: Set<string>
): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind === "message" && entry.showActions && entry.message.role === "assistant" && spanMessageIds.has(entry.message.id)) {
      return entry.message.id;
    }
  }
  return null;
}

function pickAnchorMessage(messages: TaskMessage[]): TaskMessage | null {
  const responseMessages = messages.filter((message) => !isStandaloneSystemCard(message));
  const hasAssistantWork = responseMessages.some(
    (message) => message.role === "assistant" || message.role === "tool" || isActivityNotice(message)
  );
  if (!hasAssistantWork) return null;
  for (let index = responseMessages.length - 1; index >= 0; index -= 1) {
    if (responseMessages[index].role === "assistant") return responseMessages[index];
  }
  for (let index = responseMessages.length - 1; index >= 0; index -= 1) {
    if (responseMessages[index].role === "tool") return responseMessages[index];
  }
  return responseMessages[responseMessages.length - 1] ?? null;
}

export function buildConversationTurnFooterPlan(
  messages: TaskMessage[],
  entries: ConversationDisplayEntry[]
): ConversationTurnFooterPlan {
  const renderedBranchIds = collectRenderedBranchMessageIds(entries);
  const fallbackFootersBySpan = new Map<number, TurnFallbackFooter>();
  const extraBranchCandidatesByMessageId = new Map<string, TaskMessage[]>();

  for (const span of splitNonUserSpans(messages)) {
    if (span.messages.length === 0) continue;
    const spanMessageIds = new Set(span.messages.map((message) => message.id));
    const unrenderedBranchCandidates = span.messages.filter((message) => !renderedBranchIds.has(message.id));
    const visibleAssistantId = findLastVisibleAssistantMessageId(entries, spanMessageIds);

    if (visibleAssistantId) {
      if (unrenderedBranchCandidates.length > 0) {
        extraBranchCandidatesByMessageId.set(visibleAssistantId, unrenderedBranchCandidates);
      }
      continue;
    }

    const anchorMessage = pickAnchorMessage(span.messages);
    if (!anchorMessage) continue;
    fallbackFootersBySpan.set(span.spanIndex, {
      key: `empty-response-footer:${anchorMessage.id}`,
      anchorMessage,
      branchCandidates: unrenderedBranchCandidates,
      isTrailingTurn: span.isTrailingTurn
    });
  }

  return { fallbackFootersBySpan, extraBranchCandidatesByMessageId };
}

export function isUserRenderItem(item: ConversationRenderItem): boolean {
  return item.kind === "entry" && item.entry.kind === "message" && item.entry.message.role === "user";
}
