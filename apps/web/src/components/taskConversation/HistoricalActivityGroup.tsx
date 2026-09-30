import { AlertTriangle, ChevronRight } from "lucide-react";
import type { HistoricalConversationItemsProps } from "./HistoricalConversationItems";
import type { ConversationActivityGroup } from "./conversationActivityEntries";
import { getInlineResponseSegments } from "../../task/inlineResponseSegments";
import { getModelRetryMessageDetails } from "../../task/taskConversationDisplay";
import { ThoughtSummaryBubble } from "./ThoughtSummaryBubble";
import { ToolGroupBubble } from "./ToolGroupBubble";

export function HistoricalActivityGroup(props: HistoricalConversationItemsProps & {
  group: ConversationActivityGroup;
  groupKey: string;
}): JSX.Element {
  const { group, groupKey } = props;
  const thoughtSummary = props.resolvedAssistantMessageDisplayPreferences.showThoughts && group.thoughts.length > 0 ? {
    label: group.thoughts.length === 1 ? group.thoughts[0].label : "Thought",
    content: group.thoughts.map((thought) => thought.content).join("\n\n"),
    displayPreferences: props.resolvedAssistantMessageDisplayPreferences
  } : undefined;
  const latestNotice = group.notices[group.notices.length - 1];
  const activeRetry = latestNotice?.id === props.messages[props.messages.length - 1]?.id
    ? getModelRetryMessageDetails(latestNotice) : null;
  const noticeIds = group.notices.map((notice) => notice.id);
  const sourceMessageIds = props.messages.filter((message) => group.messageIds.includes(message.id)
    && message.role === "assistant" && !message.content_json.text && getInlineResponseSegments(message).length === 0)
    .map((message) => message.id);
  const hydratedIds = new Set([...props.hydratedMessageIds,
    ...group.toolGroup.filter((tool) => tool.id.includes(":response-tool:")).map((tool) => tool.id)]);

  return (
    <>
      {group.toolGroup.length > 0 ? (
        <ToolGroupBubble toolGroup={group.toolGroup} groupKey={groupKey} messageIds={sourceMessageIds}
          hydratedMessageIds={hydratedIds} onExpandRequested={props.onToolGroupExpandRequested}
          isSelected={props.selectedToolGroupKey === groupKey} thoughtSummary={thoughtSummary}
          onInspectRequested={props.onToolGroupInspectorRequested} />
      ) : thoughtSummary ? <ThoughtSummaryBubble {...thoughtSummary} /> : null}
      {group.notices.length > 0 ? (
        <div className="chat-bubble activity-notices" data-message-id={noticeIds[0]}
          data-last-message-id={noticeIds[noticeIds.length - 1]} data-message-ids={noticeIds.join(" ")}>
          <button type="button" className={`activity-notices-button${props.selectedNoticeGroupKey === groupKey ? " active" : ""}`}
            onClick={() => props.onToolGroupInspectorRequested({ groupKey, toolGroup: [], notices: group.notices, view: "notices" })}>
            <AlertTriangle size={14} aria-hidden="true" />
            <span>{group.notices.length} error{group.notices.length === 1 ? "" : "s"} &amp; recovery notice{group.notices.length === 1 ? "" : "s"}</span>
            {activeRetry ? <span className="activity-notices-retry">Retrying · attempt {activeRetry.attempt}/{activeRetry.maxAttempts}</span> : null}
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  );
}
