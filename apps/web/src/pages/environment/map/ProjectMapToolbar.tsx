import { Columns3, FolderPlus, ListTree, Maximize2, MessageSquarePlus, StickyNote, X } from "lucide-react";

export type ProjectMapLayout = "tree" | "board";

export function ProjectMapToolbar(props: {
  layout: ProjectMapLayout;
  onLayoutChange: (layout: ProjectMapLayout) => void;
  onNewFolder: () => void;
  onNewCard: () => void;
  selectedCount: number;
  onAttach: (() => void) | null;
  onClearSelection: () => void;
  onExpand?: () => void;
}) {
  return (
    <div className="project-map-toolbar">
      <div className="project-map-layout-switch" role="tablist" aria-label="Map layout">
        <button type="button" role="tab" aria-selected={props.layout === "tree"} aria-label="Tree" title="Tree"
          onClick={() => props.onLayoutChange("tree")}><ListTree size={15} /></button>
        <button type="button" role="tab" aria-selected={props.layout === "board"} aria-label="Board" title="Board"
          onClick={() => props.onLayoutChange("board")}><Columns3 size={15} /></button>
      </div>
      {props.selectedCount > 0 ? (
        <div className="project-map-selection-actions">
          <span>{props.selectedCount} selected</span>
          {props.onAttach ? (
            <button type="button" className="btn primary project-map-attach" onClick={props.onAttach} title="Add to Master chat">
              <MessageSquarePlus size={14} /> Add to chat
            </button>
          ) : null}
          <button type="button" className="icon-btn-subtle" aria-label="Clear selection" onClick={props.onClearSelection}><X size={14} /></button>
        </div>
      ) : (
        <div className="project-map-toolbar-actions">
          <button type="button" className="icon-btn-subtle" aria-label="New folder" title="New folder" onClick={props.onNewFolder}><FolderPlus size={15} /></button>
          <button type="button" className="icon-btn-subtle" aria-label="New card" title="New card" onClick={props.onNewCard}><StickyNote size={15} /></button>
          {props.onExpand ? (
            <button type="button" className="icon-btn-subtle" aria-label="Open full map" title="Open full map" onClick={props.onExpand}><Maximize2 size={15} /></button>
          ) : null}
        </div>
      )}
    </div>
  );
}
