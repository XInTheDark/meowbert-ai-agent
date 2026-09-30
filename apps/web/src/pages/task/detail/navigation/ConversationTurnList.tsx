import { useState } from "react";
import { conversationPreview, type ConversationNavigation } from "@meowbert/shared/conversation-organization";

const ROW_HEIGHT = 80;
export function ConversationTurnList(props: { data: ConversationNavigation; summaries: boolean; activeId: string | null; onJump: (id: string) => void }) {
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(800);
  const items = props.summaries
    ? props.data.turns.map((turn) => ({ id: turn.id, target: turn.user_message_id ?? turn.id, index: turn.index,
      label: turn.completed ? "Turn" : "In progress", text: turn.summary }))
    : props.data.messages.map((message, index) => ({ id: message.id, target: message.id, index: index + 1,
      label: message.role === "user" ? "You" : "Assistant", text: conversationPreview(message.text) }));
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 5);
  return <div className="conversation-turn-list" onScroll={(event) => { setScrollTop(event.currentTarget.scrollTop); setHeight(event.currentTarget.clientHeight); }}>
    <div style={{ position: "relative", height: items.length * ROW_HEIGHT }}>
      {items.slice(start, end).map((item, index) => <button key={item.id}
        className={`conversation-turn-row${props.activeId === item.id ? " current" : ""}`}
        style={{ top: (start + index) * ROW_HEIGHT, height: ROW_HEIGHT }}
        onClick={() => props.onJump(item.target)} aria-current={props.activeId === item.id ? "location" : undefined} title={item.text}>
        <span className="conversation-turn-number">{item.index} · {item.label}</span>
        <span>{item.text || "Conversation turn"}</span>
      </button>)}
    </div>
  </div>;
}
