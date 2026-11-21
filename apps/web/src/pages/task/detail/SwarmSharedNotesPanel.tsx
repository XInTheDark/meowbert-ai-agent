import { useMemo, useState } from "react";
import { BellRing, MessageSquareShare } from "lucide-react";
import type { AgentSwarmNoteView } from "@meowbert/shared/agent-swarm-view";
import { InlineProgressBar } from "../../../components/InlineProgressBar";
import { formatDateTime, formatRelative } from "../../../lib/utils";

interface SwarmSharedNotesPanelProps {
  laneId: string;
  notes: AgentSwarmNoteView[];
  isLoading: boolean;
  error: string | null;
}

type NotesFilter = "lane" | "all";

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
  const [filter, setFilter] = useState<NotesFilter>("lane");
  const laneNotes = useMemo(() => props.notes.filter((note) => note.laneId === props.laneId), [props.laneId, props.notes]);
  const visibleNotes = filter === "lane" ? laneNotes : props.notes;

  return (
    <div className="swarm-lane-panel swarm-shared-notes-panel">
      <div className="swarm-shared-notes-toolbar">
        <div className="swarm-shared-notes-filter" role="tablist" aria-label="Shared notes filter">
          <button
            type="button"
            role="tab"
            aria-selected={filter === "lane"}
            className={`swarm-shared-notes-filter-btn ${filter === "lane" ? "active" : ""}`}
            onClick={() => setFilter("lane")}
          >
            <span>This lane</span>
            <span className="swarm-lane-tab-count">{laneNotes.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            className={`swarm-shared-notes-filter-btn ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            <span>All swarm</span>
            <span className="swarm-lane-tab-count">{props.notes.length}</span>
          </button>
        </div>
      </div>

      {props.isLoading && props.notes.length === 0 ? <InlineProgressBar pin="top" /> : null}
      {props.error ? <div className="error-text swarm-lane-panel-message">{props.error}</div> : null}

      <div className="swarm-shared-notes-scroll">
        {visibleNotes.length === 0 && !props.isLoading ? (
          <div className="swarm-shared-notes-empty muted-text">
            <MessageSquareShare size={18} aria-hidden="true" />
            <p>{filter === "lane" ? "No shared notes from this lane yet." : "No shared notes in this swarm yet."}</p>
          </div>
        ) : (
          <ol className="swarm-shared-notes-timeline" aria-label="Shared notes timeline">
            {visibleNotes.map((note) => (
              <SwarmSharedNoteItem
                key={note.seq}
                note={note}
                isCurrentLane={note.laneId === props.laneId}
                showAuthor={filter === "all"}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
