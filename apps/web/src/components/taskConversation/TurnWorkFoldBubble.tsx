import type { ReactNode } from "react";
import { CompletedActivityDisclosure } from "./CompletedActivityDisclosure";
import type { ConversationEntryItem, TurnWorkFold } from "./conversationTurnFolds";

function getItemMessageIds(item: ConversationEntryItem): string[] {
  const { entry } = item;
  if (entry.kind === "message") {
    return [entry.message.id];
  }
  return entry.kind === "activity" ? [...entry.messageIds, ...entry.toolGroup.map((tool) => tool.id)] : [];
}

// Wraps a finished turn's intermediate work in one row; search hits inside it force it open.
export function TurnWorkFoldBubble(props: {
  fold: TurnWorkFold;
  expansionKey?: string;
  searchMessageIds: Set<string>;
  renderItem: (item: ConversationEntryItem) => ReactNode;
}): JSX.Element {
  const messageIds = props.fold.items.flatMap(getItemMessageIds);
  return (
    <div className="chat-bubble turn-work-fold" data-message-id={messageIds[0]}
      data-last-message-id={messageIds[messageIds.length - 1]}>
      <CompletedActivityDisclosure title={props.fold.title} count={props.fold.callCount}
        expansionKey={props.expansionKey} forceExpanded={messageIds.some((id) => props.searchMessageIds.has(id))}>
        <div className="turn-work-fold-body">{props.fold.items.map(props.renderItem)}</div>
      </CompletedActivityDisclosure>
    </div>
  );
}
