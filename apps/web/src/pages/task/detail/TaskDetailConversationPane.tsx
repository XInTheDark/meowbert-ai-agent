import type { ReactNode, RefObject } from "react";
import { ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import type { AgentSummary } from "../../../components/tasks/AgentDropdown";
import { ChatInput } from "../../../components/taskConversation/ChatInput";
import { InlineProgressBar } from "../../../components/InlineProgressBar";
import { LoadingIndicator } from "../../../components/LoadingIndicator";
import { SelectedTextQuoteCard } from "../../../components/taskConversation/SelectedTextQuoteCard";
import type { MessageSelectedTextQuote, SelectedTextQuote } from "../../../components/taskConversation/selectedTextQuoteUtils";
import type { SkillSummary } from "../../../components/tasks/ToolOptionsDropdown";
import type { WorkspaceSourceSummary } from "../../../sources/sourceTypes";
import { TaskConversationMessages } from "../../../components/taskConversation/TaskConversationMessages";
import type { ToolInspectorSelection } from "../../../components/taskConversation/ToolActivityInspectorPanel";
import type {
  LiveToolCall,
  TaskAssistantMessageDisplayPreferences,
  TaskAttachment,
  TaskConversationSearchMatch,
  TaskMessage,
  TaskParameters,
  TaskToolOptions,
  TaskThreadSummary,
  TaskType,
  TaskWorkflowComposerConfig
} from "../../../lib/types";
import type { SubscriptionUsageWarning } from "../../../subscription/usageLimits";

interface TaskDetailConversationPaneProps {
  taskId: string;
  messages: TaskMessage[];
  assistantMessageDisplayPreferences: TaskAssistantMessageDisplayPreferences;
  isConversationBootstrapping: boolean;
  isConversationPageLoading: boolean;
  conversationPageLoadDirection: "older" | "newer" | null;
  isTaskRunning: boolean;
  isThinking: boolean;
  chatFeedRef: RefObject<HTMLDivElement>;
  onScroll: () => void;
  onWheel?: (event: React.WheelEvent<HTMLDivElement>) => void;
  onConversationChanged: () => void;
  onEditRequested: (message: TaskMessage) => void;
  renderBranchSwitcher: (message: TaskMessage) => ReactNode;
  threadCountsByParentMessageId?: Record<string, number>;
  threadSummariesByParentMessageId?: Record<string, TaskThreadSummary[]>;
  onThreadComposerRequested?: (message: TaskMessage, selectedText?: MessageSelectedTextQuote | null) => void;
  quotedFollowUpSelections?: SelectedTextQuote[];
  onAssistantSelectionChange?: (selection: MessageSelectedTextQuote | null) => void;
  onQuoteSelection?: (selection: MessageSelectedTextQuote) => void;
  onAskSelectionInThread?: (selection: MessageSelectedTextQuote) => void;
  onOpenSelectionThreads?: (message: TaskMessage, selection: MessageSelectedTextQuote) => void;
  onSubmitSelectionThread?: (selection: MessageSelectedTextQuote, message: string) => void | Promise<void>;
  onRemoveQuotedSelection?: (quoteIndex: number) => void;
  onThreadListRequested?: (message: TaskMessage) => void;
  enableThreadSelectionPopup?: boolean;
  liveToolCalls: LiveToolCall[];
  onInterruptLiveToolCall?: (liveCall: LiveToolCall) => void;
  interruptingLiveToolCallIds: string[];
  hydratedMessageIds: Set<string>;
  onToolGroupExpandRequested: (messageIds: string[]) => void;
  toolInspectorSelection?: ToolInspectorSelection | null;
  onToolInspectorSelectionChange?: (selection: ToolInspectorSelection | null) => void;
  renderToolInspector?: boolean;
  toolDisclosureState?: Record<string, boolean>;
  onToolDisclosureStateChange?: (nextState: Record<string, boolean>) => void;
  buildInlineArtifactUrl?: (relativePath: string) => string | null;
  isMobileViewport: boolean;
  isMobileInputExpanded: boolean;
  onMobileInputExpandedChange: (expanded: boolean) => void;
  editingMessageId: string | null;
  onCancelEdit: () => void;
  isBusy: boolean;
  followUp: string;
  onFollowUpChange: (value: string) => void;
  onSubmit: () => void;
  attachments: TaskAttachment[];
  onRemoveAttachment: (id: string) => void;
  onToggleAttachmentForceInclude?: (id: string) => void;
  onAttachFiles: (files: FileList | File[] | null) => void;
  onOpenEnvironmentFiles?: () => void;
  onOpenProjectFiles?: () => void;
  onOpenCanvases?: () => void;
  isUploading: boolean;
  pendingUploads: Array<{ id: string; label: string }>;
  toolOptions: TaskToolOptions;
  taskParameters: TaskParameters;
  taskType?: TaskType;
  workflowConfig?: TaskWorkflowComposerConfig;
  showMemorySearch: boolean;
  showComputerUse: boolean;
  allowScheduleTaskOption?: boolean;
  allowSubtasksOption?: boolean;
  onToolOptionsChange: (options: TaskToolOptions) => void;
  onTaskParametersChange: (taskParameters: TaskParameters) => void | Promise<void>;
  onWorkflowConfigChange?: (workflowConfig: TaskWorkflowComposerConfig) => void | Promise<void>;
  onStop: () => void;
  availableSkills: SkillSummary[];
  availableSources: WorkspaceSourceSummary[];
  attachableSources: WorkspaceSourceSummary[];
  availableAgents: AgentSummary[];
  selectedAgentId: string | null;
  defaultAgentId: string | null;
  modelSliderAgentIds?: string[];
  onAgentChange: (agentId: string | null) => void;
  onSourceSetupRequested?: (source: WorkspaceSourceSummary) => void;
  onOpenSourceFiles?: (source: WorkspaceSourceSummary) => void;
  showAgentSwitcher: boolean;
  errorText: string | null;
  hideComposer?: boolean;
  showMessageActions?: boolean;
  showMessageAuthors?: boolean;
  submitWithShiftEnter?: boolean;
  subscriptionUsageWarning?: SubscriptionUsageWarning | null;
  searchSelectedMessageId?: string | null;
  searchForceExpandedMessageIds?: Set<string>;
  searchSelectedMatch?: TaskConversationSearchMatch | null;
  isNearBottom?: boolean;
  showScrollToBottomButton?: boolean;
  onScrollToBottomRequested?: () => void;
}

function getCollapsedInputLabel(editingMessageId: string | null, followUp: string): string {
  if (editingMessageId) {
    return "Continue editing message";
  }

  const trimmed = followUp.trim();
  return trimmed.length > 0 ? trimmed : "Reply to the agent...";
}

function getCollapsedInputHint(attachmentCount: number): string {
  if (attachmentCount > 0) {
    return `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"} attached`;
  }

  return "Tap to expand";
}

export function TaskDetailConversationPane(props: TaskDetailConversationPaneProps) {
  const isMobileInputCollapsed = props.isMobileViewport && !props.isMobileInputExpanded;
  const collapsedInputLabel = getCollapsedInputLabel(props.editingMessageId, props.followUp);
  const collapsedInputHint = getCollapsedInputHint(props.attachments.length + props.pendingUploads.length);
  const showMessageActions = props.showMessageActions ?? true;
  const hideComposer = props.hideComposer === true;
  const showScrollToBottomButton =
    props.showScrollToBottomButton !== false
    && !(props.isNearBottom ?? true)
    && Boolean(props.onScrollToBottomRequested);

  return (
    <>
      <div
        className="chat-feed task-chat-feed"
        ref={props.chatFeedRef}
        onScroll={props.onScroll}
        onWheel={props.onWheel}
      >
        {props.isConversationPageLoading && props.conversationPageLoadDirection === "older" ? (
          <InlineProgressBar pin="top" label="Loading earlier messages" delayMs={200} />
        ) : null}
        {props.isConversationBootstrapping && props.messages.length === 0 ? (
          <LoadingIndicator center label="Loading conversation" />
        ) : (
          <TaskConversationMessages
            taskId={props.taskId}
            messages={props.messages}
            assistantMessageDisplayPreferences={props.assistantMessageDisplayPreferences}
            showMessageActions={showMessageActions}
            showMessageAuthors={props.showMessageAuthors ?? false}
            showThinking={props.isThinking && props.isTaskRunning}
            onConversationChanged={props.onConversationChanged}
            onEditRequested={props.onEditRequested}
            renderBranchSwitcher={props.renderBranchSwitcher}
            threadCountsByParentMessageId={props.threadCountsByParentMessageId}
            threadSummariesByParentMessageId={props.threadSummariesByParentMessageId}
            onThreadComposerRequested={props.onThreadComposerRequested}
            onAssistantSelectionChange={props.onAssistantSelectionChange}
            onQuoteSelection={props.onQuoteSelection}
            onAskSelectionInThread={props.onAskSelectionInThread}
            onOpenSelectionThreads={props.onOpenSelectionThreads}
            onSubmitSelectionThread={props.onSubmitSelectionThread}
            onThreadListRequested={props.onThreadListRequested}
            enableThreadSelectionPopup={props.enableThreadSelectionPopup}
            liveToolCalls={props.isTaskRunning ? props.liveToolCalls : []}
            onInterruptLiveToolCall={props.isTaskRunning ? props.onInterruptLiveToolCall : undefined}
            interruptingLiveToolCallIds={props.interruptingLiveToolCallIds}
            hydratedMessageIds={props.hydratedMessageIds}
            onToolGroupExpandRequested={props.onToolGroupExpandRequested}
            toolInspectorSelection={props.toolInspectorSelection}
            onToolInspectorSelectionChange={props.onToolInspectorSelectionChange}
            toolDisclosureState={props.toolDisclosureState}
            onToolDisclosureStateChange={props.onToolDisclosureStateChange}
            renderToolInspector={props.renderToolInspector ?? false}
            buildInlineArtifactUrl={props.buildInlineArtifactUrl}
            searchSelectedMessageId={props.searchSelectedMessageId}
            searchForceExpandedMessageIds={props.searchForceExpandedMessageIds}
            searchSelectedMatch={props.searchSelectedMatch}
            conversationContainerRef={props.chatFeedRef}
            stagedAnnotationCount={props.quotedFollowUpSelections?.length ?? 0}
          />
        )}
        {props.isConversationPageLoading && props.conversationPageLoadDirection !== "older" ? (
          <InlineProgressBar label="Loading newer messages" delayMs={0} />
        ) : null}
        {showScrollToBottomButton ? (
          <button
            type="button"
            className="scroll-to-bottom-btn"
            onClick={props.onScrollToBottomRequested}
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
          >
            <ChevronDown size={18} />
          </button>
        ) : null}
      </div>

      {hideComposer ? null : (
        <div className={`chat-input-container${isMobileInputCollapsed ? " mobile-collapsed" : ""}`}>
          {isMobileInputCollapsed ? (
            <button
              type="button"
              className="chat-input-mobile-strip"
              onClick={() => props.onMobileInputExpandedChange(true)}
              aria-expanded={false}
              aria-label="Expand message input"
            >
              <span className="chat-input-mobile-strip-main">
                <MessageSquare size={15} />
                <span>{collapsedInputLabel}</span>
              </span>
              <span className="chat-input-mobile-strip-hint">
                <span>{collapsedInputHint}</span>
                <ChevronUp size={16} />
              </span>
            </button>
          ) : (
            <>
              {props.isMobileViewport ? (
                <div className="chat-input-mobile-header">
                  <button
                    type="button"
                    className="chat-input-mobile-collapse-btn"
                    onClick={() => props.onMobileInputExpandedChange(false)}
                    aria-label="Collapse message input"
                    title="Collapse message input"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
              ) : null}
              {props.editingMessageId ? (
                <div className="edit-mode-banner">
                  <span>Editing a previous message. Sending will create a new branch.</span>
                  <button
                    type="button"
                    className="btn ghost"
                    style={{ padding: "0.2rem 0.5rem", fontSize: "0.78rem" }}
                    onClick={props.onCancelEdit}
                    disabled={props.isBusy}
                  >
                    Cancel edit
                  </button>
                </div>
              ) : null}
              {(props.quotedFollowUpSelections?.length ?? 0) > 0 ? (
                <div className="selected-text-quote-list follow-up-quote-list">
                  {props.quotedFollowUpSelections?.some((q) => Boolean(q.comment?.trim())) ? (
                    <div className="composer-annotations-header">
                      <span className="composer-annotation-pill">
                        <MessageSquare size={13} />
                        <span>
                          {props.quotedFollowUpSelections.filter((q) => Boolean(q.comment?.trim())).length}{" "}
                          annotation{props.quotedFollowUpSelections.filter((q) => Boolean(q.comment?.trim())).length === 1 ? "" : "s"}
                        </span>
                      </span>
                    </div>
                  ) : null}
                  {props.quotedFollowUpSelections?.map((quote, index) => (
                    <SelectedTextQuoteCard
                      key={`${quote.location ?? "quote"}:${index}:${quote.text.slice(0, 24)}`}
                      quote={quote}
                      index={index + 1}
                      onRemove={() => props.onRemoveQuotedSelection?.(index)}
                    />
                  ))}
                </div>
              ) : null}
              <ChatInput
                value={props.followUp}
                onChange={props.onFollowUpChange}
                onSubmit={props.onSubmit}
                isSubmitting={props.isBusy}
                hasExternalContent={(props.quotedFollowUpSelections?.length ?? 0) > 0}
                placeholder={props.editingMessageId ? "Edit message..." : "Reply to the agent..."}
                attachments={props.attachments}
                onRemoveAttachment={props.onRemoveAttachment}
                onToggleAttachmentForceInclude={props.onToggleAttachmentForceInclude}
                onAttachFiles={props.onAttachFiles}
                onOpenEnvironmentFiles={props.onOpenEnvironmentFiles}
                onOpenProjectFiles={props.onOpenProjectFiles}
                onOpenCanvases={props.onOpenCanvases}
                isUploading={props.isUploading}
                pendingUploads={props.pendingUploads}
                toolOptions={props.toolOptions}
                taskParameters={props.taskParameters}
                taskType={props.taskType}
                workflowConfig={props.workflowConfig}
                onWorkflowConfigChange={props.onWorkflowConfigChange}
                showMemorySearch={props.showMemorySearch}
                showComputerUse={props.showComputerUse}
                allowScheduleTaskOption={props.allowScheduleTaskOption}
                allowSubtasksOption={props.allowSubtasksOption}
                onToolOptionsChange={props.onToolOptionsChange}
                onTaskParametersChange={props.onTaskParametersChange}
                taskParametersMode="edit"
                isTaskRunning={props.isTaskRunning}
                onStop={props.onStop}
                availableSkills={props.availableSkills}
                availableSources={props.availableSources}
                attachableSources={props.attachableSources}
                availableAgents={props.availableAgents}
                selectedAgentId={props.selectedAgentId}
                defaultAgentId={props.defaultAgentId}
                modelSliderAgentIds={props.modelSliderAgentIds}
                onAgentChange={props.onAgentChange}
                onSourceSetupRequested={props.onSourceSetupRequested}
                onOpenSourceFiles={props.onOpenSourceFiles}
                showAgentSwitcher={props.showAgentSwitcher}
                submitWithShiftEnter={props.submitWithShiftEnter}
                subscriptionUsageWarning={props.subscriptionUsageWarning}
              />
              {props.errorText ? (
                <p className="error-text" style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
                  {props.errorText}
                </p>
              ) : null}
            </>
          )}
        </div>
      )}
    </>
  );
}
