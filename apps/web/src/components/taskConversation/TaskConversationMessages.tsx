import { memo, type ReactNode, type RefObject } from "react";
import "katex/dist/katex.min.css";
import { buildDefaultTaskAssistantMessageDisplayPreferences, normalizeTaskAssistantMessageDisplayPreferences } from "../../task/taskPagePreferences";
import type { LiveToolCall, TaskAssistantMessageDisplayPreferences, TaskConversationSearchMatch, TaskMessage, TaskThreadSummary } from "../../lib/types";
import { ConversationSearchMatchMarker } from "./ConversationSearchMatchMarker";
import { HistoricalConversationItems } from "./HistoricalConversationItems";
import { LiveToolCallsBubble } from "./LiveToolCallsBubble";
import { MarkdownInlineFileContext } from "./MarkdownInlineFileContext";
import { ToolActivityInspectorPanel, type ToolInspectorSelection } from "./ToolActivityInspectorPanel";
import type { MessageSelectedTextQuote } from "./selectedTextQuoteUtils";
export {
  buildStableHistoricalToolGroupDescriptors,
  getHistoricalToolGroupKey
} from "./shared";
import { useConversationActivityInspector } from "./useConversationActivityInspector";
import { useStableHistoricalToolGroupDescriptors } from "./useStableHistoricalToolGroupDescriptors";

export interface TaskConversationMessagesProps {
  messages: TaskMessage[];
  taskId?: string;
  showMessageActions?: boolean;
  showMessageAuthors?: boolean;
  showThinking?: boolean;
  isTaskRunning?: boolean;
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
  liveToolCalls?: LiveToolCall[];
  onInterruptLiveToolCall?: (liveCall: LiveToolCall) => void;
  interruptingLiveToolCallIds?: string[];
  hydratedMessageIds?: Set<string>;
  onToolGroupExpandRequested?: (messageIds: string[]) => void;
  assistantMessageDisplayPreferences?: TaskAssistantMessageDisplayPreferences;
  toolInspectorSelection?: ToolInspectorSelection | null;
  onToolInspectorSelectionChange?: (selection: ToolInspectorSelection | null) => void;
  renderToolInspector?: boolean;
  toolDisclosureState?: Record<string, boolean>;
  onToolDisclosureStateChange?: (nextState: Record<string, boolean>) => void;
  buildInlineArtifactUrl?: (relativePath: string) => string | null;
  searchSelectedMessageId?: string | null;
  searchForceExpandedMessageIds?: Set<string>;
  searchSelectedMatch?: TaskConversationSearchMatch | null;
  conversationContainerRef?: RefObject<HTMLElement>;
  stagedAnnotationCount?: number;
}


function TaskConversationMessagesComponent(props: TaskConversationMessagesProps) {
  const {
    messages,
    liveToolCalls = [],
    hydratedMessageIds = new Set<string>(),
    interruptingLiveToolCallIds = [],
    renderToolInspector = true
  } = props;
  const defaultAssistantMessageDisplayPreferences = buildDefaultTaskAssistantMessageDisplayPreferences();
  const resolvedAssistantMessageDisplayPreferences = normalizeTaskAssistantMessageDisplayPreferences(
    props.assistantMessageDisplayPreferences
  );
  const historicalToolGroupDescriptorsByStartIndex = useStableHistoricalToolGroupDescriptors(messages);
  const {
    resolvedInspectorSelection, toolDisclosureState, setSelectedInspector, handleToolDisclosureChange,
    handleToolGroupInspectorRequested, handleLiveToolInspectorRequested
  } = useConversationActivityInspector({ ...props, liveToolCalls });
  const historicalSelection = resolvedInspectorSelection?.kind === "historical" ? resolvedInspectorSelection : null;

  return (
    <MarkdownInlineFileContext.Provider value={props.buildInlineArtifactUrl ?? null}>
      <HistoricalConversationItems
        {...props}
        showMessageActions={props.showMessageActions ?? false}
        enableThreadSelectionPopup={props.enableThreadSelectionPopup ?? true}
        hydratedMessageIds={hydratedMessageIds}
        onToolGroupExpandRequested={props.onToolGroupExpandRequested}
        onToolGroupInspectorRequested={handleToolGroupInspectorRequested}
        selectedToolGroupKey={historicalSelection?.view !== "notices" ? historicalSelection?.groupKey : null}
        selectedNoticeGroupKey={historicalSelection?.view === "notices" ? historicalSelection.groupKey : null}
        defaultAssistantMessageDisplayPreferences={defaultAssistantMessageDisplayPreferences}
        resolvedAssistantMessageDisplayPreferences={resolvedAssistantMessageDisplayPreferences}
        historicalToolGroupDescriptorsByStartIndex={historicalToolGroupDescriptorsByStartIndex}
      />
      {props.conversationContainerRef ? (
        <ConversationSearchMatchMarker
          containerRef={props.conversationContainerRef}
          match={props.searchSelectedMatch ?? null}
          messages={messages}
        />
      ) : null}
      {liveToolCalls.length > 0 ? (
        <LiveToolCallsBubble
          liveToolCalls={liveToolCalls}
          isSelected={resolvedInspectorSelection?.kind === "live"}
          onInspectRequested={handleLiveToolInspectorRequested}
        />
      ) : null}
      {renderToolInspector ? (
        <ToolActivityInspectorPanel
          selection={resolvedInspectorSelection}
          hydratedMessageIds={hydratedMessageIds}
          toolDisclosureState={toolDisclosureState}
          interruptingLiveToolCallIds={interruptingLiveToolCallIds}
          onClose={() => setSelectedInspector(null)}
          onToolDisclosureChange={handleToolDisclosureChange}
          onInterruptLiveToolCall={props.onInterruptLiveToolCall}
          onExpandRequested={props.onToolGroupExpandRequested}
        />
      ) : null}
      {props.showThinking && resolvedAssistantMessageDisplayPreferences.showThoughts && (
        <div className="chat-bubble assistant">
          <div className="bubble-content thinking-bubble">
            <span className="thinking-dots">
              <span />
              <span />
              <span />
            </span>
          </div>
        </div>
      )}
    </MarkdownInlineFileContext.Provider>
  );
}

export const TaskConversationMessages = memo(TaskConversationMessagesComponent);
