import { useLayoutEffect, useRef } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import type { MapPosition } from "./conversationMapLayout";

export function ConversationMapNode(props: {
  item: MapPosition; active: boolean; collapsed: boolean; expanded: boolean;
  onToggleBranch: () => void; onToggleSummary: () => void; onJump: (id: string) => void;
  onMeasure: (id: string, height: number) => void;
}) {
  const { item, expanded, onMeasure } = props;
  const node = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = node.current;
    if (!element || !expanded) return;
    const measure = () => { if (element.offsetHeight) onMeasure(item.turn.id, element.offsetHeight); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element); return () => observer.disconnect();
  }, [expanded, item.turn.id, item.turn.summary, onMeasure]);
  return <div ref={node} className={`conversation-map-node${item.main ? " on-main-path" : ""}${props.active ? " current" : ""}${expanded ? " summary-expanded" : ""}`}
    style={{ left: item.x, top: item.y }}
    onKeyDown={(event) => { if (expanded && event.key === "Escape") { event.stopPropagation(); props.onToggleSummary(); node.current?.querySelector<HTMLButtonElement>("button")?.focus(); } }}>
    <button className="conversation-map-summary" onClick={props.onToggleSummary} aria-expanded={expanded}
      title={expanded ? "Collapse summary" : "Expand summary"} aria-current={props.active ? "location" : undefined}>
      <span className="conversation-map-node-heading">
        <span className="conversation-turn-number">{item.turn.index}{!item.turn.completed ? " · In progress" : ""}</span>
        {expanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
      </span>
      <span>{item.turn.summary || "Conversation turn"}</span>
    </button>
    {expanded ? <div className="conversation-map-node-actions">
      <button className="icon-btn-subtle" title="Jump to message" aria-label={`Jump to turn ${item.turn.index}`}
        onClick={() => props.onJump(item.turn.user_message_id ?? item.turn.id)}><ArrowUpRight size={16} /></button>
    </div> : null}
    {item.childCount > 0 ? <button className="conversation-map-collapse" aria-label={`${props.collapsed ? "Expand" : "Collapse"} turns after ${item.turn.index}`} onClick={props.onToggleBranch}>
      {props.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
    </button> : null}
  </div>;
}
