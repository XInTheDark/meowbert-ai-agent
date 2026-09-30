import { useEffect, useRef, useState, type RefObject } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import type { ConversationNavigationController, NavigationView } from "./useConversationNavigation";
import { ConversationOutline } from "./ConversationOutline";
import { ConversationTurnList } from "./ConversationTurnList";
import { ConversationMap } from "./ConversationMap";
import { handleNavigationTabKey, useNavigationKeyboard } from "./useNavigationKeyboard";

const views: NavigationView[] = ["map", "outline", "list"];

export function ConversationNavigationPane(props: {
  controller: ConversationNavigationController; overlay: boolean; summaries: boolean;
  chatFeedRef: RefObject<HTMLDivElement>; onJump: (id: string) => void;
}) {
  const { controller: navigation } = props;
  const panel = useRef<HTMLElement>(null);
  const onKeyDown = useNavigationKeyboard(panel, navigation.isOpen && props.overlay, navigation.close);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    const feed = props.chatFeedRef.current;
    if (!feed || !navigation.data) return;
    const turnByMessage = new Map(navigation.data.turns.flatMap((turn) => turn.message_ids.map((id) => [id, turn.id] as const)));
    const update = () => {
      const top = feed.getBoundingClientRect().top + Math.min(feed.clientHeight * 0.24, 180);
      let found: string | null = null;
      for (const row of feed.querySelectorAll<HTMLElement>("[data-message-id]")) {
        const id = turnByMessage.get(row.dataset.messageId ?? "");
        if (id && (!found || row.getBoundingClientRect().top <= top)) found = id;
      }
      setActiveId(found);
    };
    update(); feed.addEventListener("scroll", update, { passive: true });
    return () => feed.removeEventListener("scroll", update);
  }, [props.chatFeedRef, navigation.data]);
  const jump = (id: string) => { props.onJump(id); if (props.overlay) navigation.close(); };
  return <>
    {navigation.isOpen && props.overlay ? <div className="conversation-navigation-backdrop" aria-hidden="true" onClick={navigation.close} /> : null}
    <aside ref={panel} className={`conversation-navigation${props.overlay ? " overlay" : ""}${navigation.expanded ? " expanded" : ""}`}
      hidden={!navigation.isOpen} aria-label="Conversation navigation" role={props.overlay ? "dialog" : undefined} aria-modal={props.overlay || undefined}
      onKeyDown={onKeyDown}>
      <div className="conversation-navigation-header">
        <div role="tablist" aria-label="Conversation navigation views">
          {views.map((view) => <button key={view} role="tab" tabIndex={navigation.view === view ? 0 : -1}
            id={`navigation-${view}-tab`} aria-controls={`navigation-${view}`} aria-selected={navigation.view === view}
            onClick={() => navigation.selectView(view)} onKeyDown={(event) => handleNavigationTabKey(event, (index) => navigation.selectView(views[index]))}
          >{view === "map" ? "Map" : view === "outline" ? "Outline" : "List"}</button>)}
        </div>
        <button className="icon-btn-subtle" aria-label={navigation.expanded ? "Restore navigation size" : "Expand navigation"}
          onClick={() => navigation.setExpanded(!navigation.expanded)}>{navigation.expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
        <button className="icon-btn-subtle" aria-label="Close navigation" onClick={navigation.close}><X size={17} /></button>
      </div>
      {navigation.error ? <div className="conversation-navigation-error" role="status">{navigation.error} <button onClick={navigation.retry}>Retry</button></div> : null}
      {!navigation.data && !navigation.error ? <p className="muted-text">Loading navigation…</p> : null}
      {navigation.data ? <>
        <section id="navigation-map" role="tabpanel" aria-labelledby="navigation-map-tab" hidden={navigation.view !== "map"}>
          <ConversationMap data={navigation.data} activeId={activeId} onJump={jump} />
        </section>
        <section id="navigation-outline" role="tabpanel" aria-labelledby="navigation-outline-tab" hidden={navigation.view !== "outline"}>
          <ConversationOutline markdown={navigation.data.outline?.markdown ?? null} onJump={jump} />
        </section>
        <section id="navigation-list" role="tabpanel" aria-labelledby="navigation-list-tab" hidden={navigation.view !== "list"}>
          <ConversationTurnList data={navigation.data} activeId={activeId} summaries={props.summaries} onJump={jump} />
        </section>
      </> : null}
      {!props.overlay ? <NavigationResize width={navigation.width} onChange={navigation.setWidth} /> : null}
    </aside>
  </>;
}

function NavigationResize(props: { width: number; onChange: (width: number) => void }) {
  return <div className="conversation-navigation-resize" role="separator" aria-label="Resize navigation" aria-orientation="vertical"
    tabIndex={0} aria-valuenow={props.width} aria-valuemin={420} aria-valuemax={800}
    onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); props.onChange(props.width + (event.key === "ArrowRight" ? 20 : -20)); } }}
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
    onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      const left = event.currentTarget.parentElement!.getBoundingClientRect().left;
      props.onChange(event.clientX - left);
    } }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} />;
}
