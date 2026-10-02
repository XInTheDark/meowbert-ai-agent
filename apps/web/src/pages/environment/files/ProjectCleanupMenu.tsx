import { Loader2, MoreVertical } from "lucide-react";

interface ProjectCleanupMenuProps {
  isOpen: boolean;
  isLoading: boolean;
  onToggle: () => void;
  onCleanupRequest: () => void;
  onAiCleanupRequest: () => void;
}

export function ProjectCleanupMenu(props: ProjectCleanupMenuProps) {
  return (
    <div className="topbar-dropdown" onClick={(event) => event.stopPropagation()}>
      <button className="btn ghost icon-btn" type="button" aria-label="Cleanup actions" aria-haspopup="menu" aria-expanded={props.isOpen} title="Cleanup actions" onClick={props.onToggle}><MoreVertical size={16} /></button>
      {props.isOpen ? (
        <div className="topbar-dropdown-menu">
          <button type="button" onClick={props.onCleanupRequest} disabled={props.isLoading}>{props.isLoading ? <Loader2 className="spin" size={14} /> : null}Cleanup</button>
          <button type="button" onClick={props.onAiCleanupRequest}>AI Cleanup (Beta)</button>
        </div>
      ) : null}
    </div>
  );
}
