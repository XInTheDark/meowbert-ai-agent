import { useMemo, useState, type ReactNode } from "react";
import { MessageActions } from "./MessageActions";
import { buildTaskMessageExpansionKey } from "../../task/taskMessageExpansionPreferences";
import type {
  TaskAssistantMessageDisplayPreferences,
  TaskMessage,
  TaskThreadSummary
} from "../../lib/types";
import { formatRelative, getMessageText } from "../../lib/utils";
import { AssistantSelectionContent } from "./AssistantSelectionContent";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { ContextCheckpointDialog } from "./ContextCheckpointDialog";
import { SelectedTextQuoteCard } from "./SelectedTextQuoteCard";
import type { MessageSelectedTextQuote } from "./selectedTextQuoteUtils";
import { splitSelectedTextMessage } from "./selectedTextQuoteUtils";
import type { ThoughtSummaryContentProps } from "./ThoughtSummaryBubble";
import { InlineArtifactBubble } from "./InlineArtifactBubble";
import { ManagedTaskCard } from "./ManagedTaskCard";
import {
  formatTokenCount,
  isCompactionMessage,
  isContextCheckpointMessage,
  type StableToolGroupDescriptor
} from "./shared";

import { buildConversationDisplayEntries, type ConversationDisplayEntry } from "./conversationActivityEntries";
import { HistoricalActivityGroup } from "./HistoricalActivityGroup";

export interface HistoricalConversationItemsProps {
  messages: TaskMessage[];
  taskId?: string;
  showMessageActions: boolean;
  showMessageAuthors?: boolean;
  onConversationChanged?: () => void;
  onEditRequested?: (message: TaskMessage) => void;
  renderBranchSwitcher?: (message: TaskMessage) => ReactNode;
  threadCountsByParentMessageId?: Record<string, number>;
  threadSummariesByParentMessageId?: Record<string, TaskThreadSummary[]>;
  onThreadComposerRequested?: (message: TaskMessage, selectedText?: MessageSelectedTextQuote | null) => void;
  onAssistantSelectionChange?: (selection: MessageSelectedTextQuote | null) => void;
  onQuoteSelection?: (selection: MessageSelectedTextQuote) => void;
  onAskSelectionInThread?: (selection: MessageSelectedTextQuote) => void;
  onOpenSelectionThreads?: (message: TaskMessage, selection: MessageSelectedTextQuote) => void;
  onSubmitSelectionThread?: (selection: MessageSelectedTextQuote, message: string) => void | Promise<void>;
  onThreadListRequested?: (message: TaskMessage) => void;
  enableThreadSelectionPopup?: boolean;
  hydratedMessageIds: Set<string>;
  onToolGroupExpandRequested?: (messageIds: string[]) => void;
  onToolGroupInspectorRequested: (selection: {
    groupKey: string;
    toolGroup: TaskMessage[];
    thoughtSummary?: ThoughtSummaryContentProps;
    notices?: TaskMessage[];
    view?: "notices";
  }) => void;
  selectedToolGroupKey?: string | null;
  selectedNoticeGroupKey?: string | null;
  defaultAssistantMessageDisplayPreferences: TaskAssistantMessageDisplayPreferences;
  resolvedAssistantMessageDisplayPreferences: TaskAssistantMessageDisplayPreferences;
  historicalToolGroupDescriptorsByStartIndex: Map<number, StableToolGroupDescriptor>;
  buildInlineArtifactUrl?: (relativePath: string) => string | null;
  searchSelectedMessageId?: string | null;
  searchForceExpandedMessageIds?: Set<string>;
  stagedAnnotationCount?: number;
  isTaskRunning?: boolean;
}

function CompactionMessageBubble(props: {
  message: TaskMessage;
  renderBranchSwitcher?: (message: TaskMessage) => ReactNode;
  displayPreferences: TaskAssistantMessageDisplayPreferences;
}): JSX.Element {
  const { message, renderBranchSwitcher, displayPreferences } = props;
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const compactionMeta =
    message.content_json.compaction && typeof message.content_json.compaction === "object"
      ? (message.content_json.compaction as Record<string, unknown>)
      : {};
  const beforeUsage =
    compactionMeta.usageBefore && typeof compactionMeta.usageBefore === "object"
      ? (compactionMeta.usageBefore as Record<string, unknown>)
      : {};
  const afterUsage =
    compactionMeta.usageAfter && typeof compactionMeta.usageAfter === "object"
      ? (compactionMeta.usageAfter as Record<string, unknown>)
      : {};
  const beforeTokens = typeof beforeUsage.usedTokens === "number" ? beforeUsage.usedTokens : null;
  const afterTokens = typeof afterUsage.usedTokens === "number" ? afterUsage.usedTokens : null;
  const trigger = typeof compactionMeta.trigger === "string" ? compactionMeta.trigger : "auto";
  const backend = typeof compactionMeta.backend === "string" ? compactionMeta.backend : "summary";
  const summaryText =
    typeof message.content_json.summary_markdown === "string"
      ? message.content_json.summary_markdown
      : getMessageText(message)
        || (backend === "native"
          ? "## Native Context Compaction\n\nNo human-readable summary is available."
          : "");
  const branchSwitcher = renderBranchSwitcher?.(message);
  const compactionTitle = backend === "native" ? "Context carried forward" : "Conversation summary saved";
  const compactionMetaLabel = `${trigger} · ${backend}`;

  return (
    <div key={message.id} className="chat-bubble system compaction-message" data-message-id={message.id}>
      <div className="bubble-content">
        <div className="compaction-card">
          <div className="compaction-card-main">
            <span className="compaction-marker" aria-hidden="true" />
            <div className="compaction-copy">
              <strong>{compactionTitle}</strong>
              <span>{compactionMetaLabel} · {formatRelative(message.created_at)}</span>
            </div>
          </div>
          {beforeTokens !== null && afterTokens !== null ? (
            <span className="compaction-delta">
              {formatTokenCount(beforeTokens)}{" -> "}{formatTokenCount(afterTokens)}
            </span>
          ) : null}
          <button
            type="button"
            className="compaction-toggle"
            onClick={() => setIsSummaryOpen((current) => !current)}
            aria-expanded={isSummaryOpen}
          >
            {isSummaryOpen ? "Hide summary" : "View summary"}
          </button>
        </div>
        {isSummaryOpen ? (
          <div className="compaction-summary markdown-content">
            <ConversationMessageContent content={summaryText} displayPreferences={displayPreferences} />
          </div>
        ) : null}
      </div>
      {branchSwitcher ? (
        <div className="bubble-footer">
          <div className="bubble-footer-actions">{branchSwitcher}</div>
        </div>
      ) : null}
    </div>
  );
}

function ContextCheckpointMessageBubble(props: {
  message: TaskMessage;
  renderBranchSwitcher?: (message: TaskMessage) => ReactNode;
}): JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const checkpoint = typeof props.message.content_json.checkpoint === "string"
    ? props.message.content_json.checkpoint
    : "";
  const rawAction = props.message.content_json.action;
  const action = rawAction === "trim" ? "trim" : (rawAction === "rollover" ? "rollover" : "compact");
  const trimmedCount = typeof props.message.content_json.trimmed_tool_count === "number"
    ? props.message.content_json.trimmed_tool_count
    : null;
  const reason = typeof props.message.content_json.reason === "string" ? props.message.content_json.reason : null;
  const branchSwitcher = props.renderBranchSwitcher?.(props.message);
  const title = action === "rollover" ? "Context window rollover" : "Context checkpoint saved";
  const detail = action === "rollover"
    ? (reason ? `Rollover (${reason})` : "Rollover")
    : (action === "trim" && trimmedCount !== null
      ? `${trimmedCount} oldest tool call${trimmedCount === 1 ? "" : "s"} trimmed`
      : "Compaction checkpoint");

  return (
    <div className="chat-bubble system compaction-message" data-message-id={props.message.id}>
      <div className="bubble-content">
        <div className="compaction-card">
          <div className="compaction-card-main">
            <span className="compaction-marker" aria-hidden="true" />
            <div className="compaction-copy">
              <strong>{title}</strong>
              <span>{detail} · {formatRelative(props.message.created_at)}</span>
            </div>
          </div>
          <button type="button" className="compaction-toggle" onClick={() => setIsDialogOpen(true)}>
            View checkpoint
          </button>
        </div>
      </div>
      {branchSwitcher ? (
        <div className="bubble-footer">
          <div className="bubble-footer-actions">{branchSwitcher}</div>
        </div>
      ) : null}
      {isDialogOpen ? (
        <ContextCheckpointDialog checkpoint={checkpoint} onClose={() => setIsDialogOpen(false)} />
      ) : null}
    </div>
  );
}

function resolveMessageAuthorLabel(message: TaskMessage, showMessageAuthors: boolean): string | null {
  if (message.role === "user" && message.content_json?.sender === "project_master") {
    return "Master";
  }

  if (!showMessageAuthors || message.role !== "user" || !message.author) {
    return null;
  }

  const displayName = message.author.display_name?.trim();
  if (displayName) {
    return displayName;
  }

  return message.author.email;
}

function buildSelectedTextThreadAnchors(threads: TaskThreadSummary[]): Array<{
  text: string;
  location: string | null;
  threads: TaskThreadSummary[];
}> {
  const anchorsByKey = new Map<string, { text: string; location: string | null; threads: TaskThreadSummary[] }>();
  threads.forEach((thread) => {
    const selectedText = thread.selected_text?.trim();
    if (!selectedText) {
      return;
    }

    const key = `${thread.selected_text_location ?? ""}\n${selectedText}`;
    const existing = anchorsByKey.get(key);
    if (existing) {
      existing.threads.push(thread);
      return;
    }

    anchorsByKey.set(key, {
      text: selectedText,
      location: thread.selected_text_location,
      threads: [thread]
    });
  });

  return [...anchorsByKey.values()];
}

function StandardMessageBubble(props: {
  message: TaskMessage;
  contentOverride?: string;
  taskId?: string;
  showMessageActions: boolean;
  showMessageAuthors: boolean;
  onConversationChanged?: () => void;
  onEditRequested?: (message: TaskMessage) => void;
  renderBranchSwitcher?: (message: TaskMessage) => ReactNode;
  threadCountsByParentMessageId?: Record<string, number>;
  threadSummaries?: TaskThreadSummary[];
  onThreadComposerRequested?: (message: TaskMessage, selectedText?: MessageSelectedTextQuote | null) => void;
  onAssistantSelectionChange?: (selection: MessageSelectedTextQuote | null) => void;
  onQuoteSelection?: (selection: MessageSelectedTextQuote) => void;
  onAskSelectionInThread?: (selection: MessageSelectedTextQuote) => void;
  onOpenSelectionThreads?: (message: TaskMessage, selection: MessageSelectedTextQuote) => void;
  onSubmitSelectionThread?: (selection: MessageSelectedTextQuote, message: string) => void | Promise<void>;
  onThreadListRequested?: (message: TaskMessage) => void;
  enableThreadSelectionPopup?: boolean;
  defaultAssistantMessageDisplayPreferences: TaskAssistantMessageDisplayPreferences;
  resolvedAssistantMessageDisplayPreferences: TaskAssistantMessageDisplayPreferences;
  searchSelectedMessageId?: string | null;
  searchForceExpandedMessageIds?: Set<string>;
  stagedAnnotationCount?: number;
  expansionId?: string;
}): JSX.Element {
  const {
    message,
    contentOverride,
    taskId,
    showMessageActions,
    onConversationChanged,
    onEditRequested,
    renderBranchSwitcher,
    resolvedAssistantMessageDisplayPreferences
  } = props;
  const content = contentOverride ?? getMessageText(message);
  const branchSwitcher = renderBranchSwitcher?.(message);
  const canRenderMessageActions = showMessageActions && Boolean(taskId);
  const actionTaskId = canRenderMessageActions ? taskId : undefined;
  const messageDisplayPreferences =
    message.role === "assistant"
      ? resolvedAssistantMessageDisplayPreferences
      : {
          ...resolvedAssistantMessageDisplayPreferences,
          collapseLongMessages: resolvedAssistantMessageDisplayPreferences.collapseLongMessages,
          renderMarkdown: resolvedAssistantMessageDisplayPreferences.renderUserMessages,
          hideCitationMarkers: false
        };
  const threadCount = props.threadCountsByParentMessageId?.[message.id] ?? 0;
  const canStartThread = message.role === "assistant" && typeof props.onThreadComposerRequested === "function";
  const canOpenThreadList = message.role === "assistant" && threadCount > 0 && typeof props.onThreadListRequested === "function";
  const hasFooterActions = Boolean(branchSwitcher) || Boolean(actionTaskId);
  const hasFooterActionsOrMeta = hasFooterActions;
  const authorLabel = resolveMessageAuthorLabel(message, props.showMessageAuthors ?? false);
  const [isMessageActionsVisible, setIsMessageActionsVisible] = useState(false);
  const isSearchSelected = props.searchSelectedMessageId === message.id;
  const isSearchForceExpanded = props.searchForceExpandedMessageIds?.has(message.id) ?? false;
  const selectedTextMessage = message.role === "user" ? splitSelectedTextMessage(content) : null;
  const visibleContent = selectedTextMessage?.message ?? content;
  const expansionKey = taskId
    ? buildTaskMessageExpansionKey(taskId, props.expansionId ?? message.id)
    : undefined;
  const threadAnchors = useMemo(
    () => buildSelectedTextThreadAnchors(props.threadSummaries ?? []),
    [props.threadSummaries]
  );

  return (
    <div
      key={message.id}
      className={`chat-bubble ${message.role}${isMessageActionsVisible ? " message-actions-visible" : ""}${isSearchSelected ? " search-selected" : ""}`}
      data-message-id={message.id}
      onBlurCapture={() => setIsMessageActionsVisible(false)}
      onFocusCapture={() => setIsMessageActionsVisible(true)}
      onMouseEnter={() => setIsMessageActionsVisible(true)}
      onMouseLeave={() => setIsMessageActionsVisible(false)}
    >
      {authorLabel ? <div className="message-author-label">{authorLabel}</div> : null}
      <div className="bubble-content markdown-content">
        {message.role === "assistant" ? (
          <AssistantSelectionContent
            content={content}
            displayPreferences={messageDisplayPreferences}
            enabled={canStartThread && (props.enableThreadSelectionPopup ?? true)}
            annotationIndex={(props.stagedAnnotationCount ?? 0) + 1}
            onSelectionChange={(selection) => {
              props.onAssistantSelectionChange?.(selection ? { ...selection, messageId: message.id } : null);
            }}
            onQuoteSelection={(selection) => props.onQuoteSelection?.({ ...selection, messageId: message.id })}
            onAskSelectionInThread={(selection) => props.onAskSelectionInThread?.({ ...selection, messageId: message.id })}
            onOpenSelectionThreads={(selection) => {
              props.onOpenSelectionThreads?.(message, { ...selection, messageId: message.id });
            }}
            onSubmitSelectionThread={(selection, threadMessage) => (
              props.onSubmitSelectionThread?.({ ...selection, messageId: message.id }, threadMessage)
            )}
            threadAnchors={threadAnchors}
            forceExpanded={isSearchForceExpanded}
            expansionKey={expansionKey}
          />
        ) : (
          <>
            {selectedTextMessage ? (
              <div className="selected-text-quote-list sent-quote-list">
                {selectedTextMessage.quotes.map((quote, index) => (
                  <SelectedTextQuoteCard
                    key={`${quote.location ?? "quote"}:${index}:${quote.text.slice(0, 24)}`}
                    quote={quote}
                    index={index + 1}
                  />
                ))}
              </div>
            ) : null}
            {visibleContent ? (
              <ConversationMessageContent
                content={visibleContent}
                displayPreferences={messageDisplayPreferences}
                enableLongMessageCollapse
                forceExpanded={isSearchForceExpanded}
                expansionKey={expansionKey}
              />
            ) : null}
          </>
        )}
      </div>
      <div className="bubble-footer">
        <span className="muted-text" style={{ fontSize: "0.75rem", padding: "0 0.5rem" }}>
          {formatRelative(message.created_at)}
        </span>
        {hasFooterActionsOrMeta ? (
          <div className="bubble-footer-actions">
            {branchSwitcher}
            {actionTaskId ? (
              <MessageActions
                taskId={actionTaskId}
                message={message}
                onConversationChanged={onConversationChanged}
                onEditRequested={onEditRequested}
                threadCount={threadCount}
                onThreadRequested={canStartThread ? (nextMessage) => props.onThreadComposerRequested?.(nextMessage, null) : undefined}
                onThreadListRequested={canOpenThreadList ? props.onThreadListRequested : undefined}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HistoricalMessageItem(props: HistoricalConversationItemsProps & {
  entry: Extract<ConversationDisplayEntry, { kind: "message" }>;
}): JSX.Element {
  const { entry } = props;
  const { message } = entry;
  if (message.role === "system" && isCompactionMessage(message.content_json)) {
    return <CompactionMessageBubble message={message} renderBranchSwitcher={props.renderBranchSwitcher}
      displayPreferences={props.resolvedAssistantMessageDisplayPreferences} />;
  }
  if (message.role === "system" && isContextCheckpointMessage(message.content_json)) {
    return <ContextCheckpointMessageBubble message={message} renderBranchSwitcher={props.renderBranchSwitcher} />;
  }
  return (
    <StandardMessageBubble
      {...props}
      message={message}
      contentOverride={entry.contentOverride}
      expansionId={entry.key}
      showMessageActions={entry.showActions && props.showMessageActions}
      showMessageAuthors={props.showMessageAuthors ?? false}
      onConversationChanged={entry.showActions ? props.onConversationChanged : undefined}
      onEditRequested={entry.showActions ? props.onEditRequested : undefined}
      renderBranchSwitcher={entry.showActions ? props.renderBranchSwitcher : undefined}
      threadCountsByParentMessageId={entry.showActions ? props.threadCountsByParentMessageId : undefined}
      threadSummaries={props.threadSummariesByParentMessageId?.[message.id]}
      onThreadListRequested={entry.showActions ? props.onThreadListRequested : undefined}
    />
  );
}

export function HistoricalConversationItems(props: HistoricalConversationItemsProps): JSX.Element[] {
  const entries = buildConversationDisplayEntries(props.messages);
  return entries.map((entry, index) => {
    if (entry.kind === "activity") {
      const key = props.historicalToolGroupDescriptorsByStartIndex.get(entry.startIndex)?.key ?? entry.key;
      // Only the trailing group of a running task is still in progress.
      const isComplete = !props.isTaskRunning || index < entries.length - 1;
      return <HistoricalActivityGroup key={key} {...props} group={entry} groupKey={key} isComplete={isComplete} />;
    }
    if (entry.kind === "artifact") {
      return <InlineArtifactBubble key={entry.key} messageId={entry.key} artifact={entry.artifact}
        src={props.buildInlineArtifactUrl?.(entry.artifact.relativePath) ?? null} />;
    }
    if (entry.kind === "managed-task") {
      return <ManagedTaskCard key={entry.key} messageId={entry.key} card={entry.card} />;
    }
    return <HistoricalMessageItem key={entry.key} {...props} entry={entry} />;
  });
}
