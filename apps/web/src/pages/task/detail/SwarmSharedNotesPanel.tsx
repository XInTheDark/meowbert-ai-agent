import { useEffect, useLayoutEffect, useRef } from "react";
import { BellRing, MessageSquareShare } from "lucide-react";
import type { AgentSwarmNoteView } from "@meowbert/shared/agent-swarm-view";
import { InlineProgressBar } from "../../../components/InlineProgressBar";
import { formatDateTime, formatRelative } from "../../../lib/utils";
import type { SwarmNotesFilter } from "./useSwarmSharedNotes";

interface SwarmSharedNotesPanelProps {
  laneId: string;
  filter: SwarmNotesFilter;
  onFilterChange: (filter: SwarmNotesFilter) => void;
  notes: AgentSwarmNoteView[];
  laneCount: number;
  totalCount: number;
  hasOlder: boolean;
  isLoading: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
  error: string | null;
}

type PendingScrollMode = "bottom" | { kind: "preserve"; prevScrollHeight: number; prevScrollTop: number } | null;

function formatScopeLabel(note: AgentSwarmNoteView): string | null {
  const siblings = note.notifySiblings !== false;
  const parent = note.notifyParent && note.notifyParent !== "none";
  if (siblings && parent) return "All";
  if (parent && !siblings) return "Parent";
  if (siblings && !parent) return "Siblings";
  return null;
}

function SwarmSharedNoteItem(props: { note: AgentSwarmNoteView; isCurrentLane: boolean; showAuthor: boolean }) {
  const { note } = props;
  const isWake = note.notifyParent === "wake";
  const scopeLabel = formatScopeLabel(note);

  return (
    <li className={`swarm-shared-note-item ${isWake ? "is-urgent" : ""}`}>
      <span className="swarm-shared-note-dot" aria-hidden="true" />
      <div className="swarm-shared-note-card">
        <div className="swarm-shared-note-header">
          <div className="swarm-shared-note-meta">
            {props.showAuthor ? (
              <span className={`swarm-shared-note-author ${props.isCurrentLane ? "is-current" : ""}`}>
                {note.laneTitle}
              </span>
            ) : null}
            {scopeLabel ? <span className="swarm-shared-note-pill">{scopeLabel}</span> : null}
            {isWake ? (
              <span className="swarm-shared-note-pill is-wake">
                <BellRing size={11} aria-hidden="true" />
                <span>Woke parent</span>
              </span>
            ) : null}
          </div>
          <time className="swarm-shared-note-time muted-text" dateTime={note.createdAt} title={formatDateTime(note.createdAt)}>
            {formatRelative(note.createdAt)}
          </time>
        </div>
        <div className="swarm-shared-note-body">{note.content}</div>
      </div>
    </li>
  );
}

export function SwarmSharedNotesPanel(props: SwarmSharedNotesPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef<PendingScrollMode>("bottom");
  const wasNearBottomRef = useRef(true);
  const prevNoteCountRef = useRef(0);

  useEffect(() => {
    pendingScrollRef.current = "bottom";
    wasNearBottomRef.current = true;
    prevNoteCountRef.current = 0;
  }, [props.laneId, props.filter]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mode = pendingScrollRef.current;
    if (mode === "bottom") {
      if (!props.isLoading || props.notes.length > 0) {
        el.scrollTop = el.scrollHeight;
        if (!props.isLoading) pendingScrollRef.current = null;
      }
    } else if (mode?.kind === "preserve" && !props.isLoadingOlder) {
      el.scrollTop = Math.max(0, el.scrollHeight - mode.prevScrollHeight + mode.prevScrollTop);
      pendingScrollRef.current = null;
    } else if (wasNearBottomRef.current && props.notes.length > prevNoteCountRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevNoteCountRef.current = props.notes.length;
  }, [props.filter, props.isLoading, props.isLoadingOlder, props.laneId, props.notes]);

  function handleLoadOlder(): void {
    const el = scrollRef.current;
    if (el) {
      pendingScrollRef.current = { kind: "preserve", prevScrollHeight: el.scrollHeight, prevScrollTop: el.scrollTop };
    }
    props.onLoadOlder();
  }

  return (
    <div className="swarm-lane-panel swarm-shared-notes-panel">
      <div className="swarm-shared-notes-toolbar">
        <div className="swarm-shared-notes-filter" role="tablist" aria-label="Shared notes filter">
          <button
            type="button"
            role="tab"
            aria-selected={props.filter === "lane"}
            className={`swarm-shared-notes-filter-btn ${props.filter === "lane" ? "active" : ""}`}
            onClick={() => props.onFilterChange("lane")}
          >
            <span>This lane</span>
            <span className="swarm-lane-tab-count">{props.laneCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={props.filter === "all"}
            className={`swarm-shared-notes-filter-btn ${props.filter === "all" ? "active" : ""}`}
            onClick={() => props.onFilterChange("all")}
          >
            <span>All swarm</span>
            <span className="swarm-lane-tab-count">{props.totalCount}</span>
          </button>
        </div>
      </div>

      {props.isLoading && props.notes.length === 0 ? <InlineProgressBar pin="top" /> : null}
      {props.error ? <div className="error-text swarm-lane-panel-message">{props.error}</div> : null}

      <div
        className="swarm-shared-notes-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 64;
        }}
      >
        {props.hasOlder && props.notes.length > 0 ? (
          <button
            type="button"
            className="conversation-load-older"
            onClick={handleLoadOlder}
            disabled={props.isLoadingOlder}
          >
            {props.isLoadingOlder ? "Loading…" : "Load earlier notes"}
          </button>
        ) : null}
        {props.notes.length === 0 && !props.isLoading ? (
          <div className="swarm-shared-notes-empty muted-text">
            <MessageSquareShare size={18} aria-hidden="true" />
            <p>{props.filter === "lane" ? "No shared notes from this lane yet." : "No shared notes in this swarm yet."}</p>
          </div>
        ) : (
          <ol className="swarm-shared-notes-timeline" aria-label="Shared notes timeline">
            {props.notes.map((note) => (
              <SwarmSharedNoteItem
                key={note.seq}
                note={note}
                isCurrentLane={note.laneId === props.laneId}
                showAuthor={props.filter === "all"}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
