import { useCallback, useMemo, useState } from "react";
import { Crosshair, Minus, Plus } from "lucide-react";
import type { ConversationNavigation } from "@meowbert/shared/conversation-organization";
import { layoutConversationMap, mapTopicGroups, MAP_NODE_HEIGHT } from "./conversationMapLayout";
import { ConversationMapNode } from "./ConversationMapNode";
import { useMapViewport } from "./useMapViewport";

export function ConversationMap(props: { data: ConversationNavigation; activeId: string | null; onJump: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState<{ id: string; height: number } | null>(null);
  const onMeasure = useCallback((id: string, height: number) => {
    setExpanded((current) => current?.id === id && current.height !== height ? { id, height } : current);
  }, []);
  const positions = useMemo(() => layoutConversationMap(props.data.turns, props.data.map?.graph ?? null, collapsed, expanded), [props.data, collapsed, expanded]);
  const { feed, viewport, measure, reveal } = useMapViewport(positions, zoom, () => setCollapsed(new Set()));
  const groups = useMemo(() => mapTopicGroups(positions), [positions]);
  const byId = useMemo(() => new Map(positions.map((item) => [item.turn.id, item])), [positions]);
  const graphWidth = Math.max(480, ...positions.map((item) => item.x + 228));
  const last = positions.at(-1);
  const graphHeight = last ? last.y + last.height + 48 : 200;
  const visible = positions.filter((item) => item.y + item.height + 38 >= viewport.top / zoom - 150 && item.y <= (viewport.top + viewport.height) / zoom + 150);
  function revealCurrent() {
    reveal(props.activeId ?? props.data.turns.at(-1)?.id ?? "");
  }
  function toggle(id: string) { setCollapsed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  return <div className="conversation-map">
    <div className="conversation-map-tools">
      <button className="icon-btn-subtle" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.6, value - 0.1))}><Minus size={16} /></button>
      <span>{Math.round(zoom * 100)}%</span>
      <button className="icon-btn-subtle" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.4, value + 0.1))}><Plus size={16} /></button>
      <button className="icon-btn-subtle" aria-label="Current turn" title="Current turn" onClick={revealCurrent}><Crosshair size={16} /></button>
    </div>
    <div className="conversation-map-viewport" ref={feed} onScroll={measure} tabIndex={0} aria-label="Conversation map">
      <div style={{ width: graphWidth * zoom, height: graphHeight * zoom, position: "relative" }}>
        <div className="conversation-map-canvas" style={{ width: graphWidth, height: graphHeight, transform: `scale(${zoom})` }}>
          {groups.filter((group) => group.y + group.height >= viewport.top / zoom - 150 && group.y <= (viewport.top + viewport.height) / zoom + 150)
            .map((group, index) => <div key={`${group.topicId}-${index}`} className={`conversation-map-topic topic-${topicColor(group.topicId)}`}
            style={{ left: group.x, top: group.y, height: group.height }}>
            <span>{props.data.map?.graph.topics.find((topic) => topic.id === group.topicId)?.label}</span>
          </div>)}
          <svg className="conversation-map-edges" width={graphWidth} height={graphHeight} aria-hidden="true">
            {positions.map((item) => {
              const parent = item.parentId ? byId.get(item.parentId) : null;
              if (!parent || item.y < viewport.top / zoom - 150 || parent.y > (viewport.top + viewport.height) / zoom + 150) return null;
              return <path key={item.turn.id} className={item.main && parent.main ? "main-path" : ""}
                d={`M ${parent.x + 104} ${parent.y + parent.height} V ${parent.y + parent.height + 14} H ${item.x + 104} V ${item.y}`} />;
            })}
          </svg>
          {visible.map((item) => <ConversationMapNode key={item.turn.id} item={item} active={props.activeId === item.turn.id}
            collapsed={collapsed.has(item.turn.id)} onToggleBranch={() => toggle(item.turn.id)} onJump={props.onJump}
            expanded={expanded?.id === item.turn.id} onMeasure={onMeasure}
            onToggleSummary={() => setExpanded((current) => current?.id === item.turn.id ? null : { id: item.turn.id, height: MAP_NODE_HEIGHT })} />)}
        </div>
      </div>
    </div>
  </div>;
}

function topicColor(id: string): number { return [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4; }
