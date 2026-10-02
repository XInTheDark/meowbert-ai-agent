import { ArrowUp, Grid, Home, List as ListIcon, Trash2 } from "lucide-react";
import { AttachFilesMenu } from "../../../components/files/AttachFilesMenu";
import type { WorkspaceSourceSummary } from "../../../sources/sourceTypes";

interface ProjectContextToolbarProps {
  cwd: string;
  parentPath: string | null;
  isLoading: boolean;
  viewMode: "list" | "grid";
  selectedCount: number;
  isUploading: boolean;
  sources: WorkspaceSourceSummary[];
  onNavigate: (path: string) => void;
  onViewModeChange: (mode: "list" | "grid") => void;
  onRemoveSelected: () => void;
  onUploadFiles: (files: File[]) => void;
  onCreateTextFile: () => void;
  onAttachFromSource: (source: WorkspaceSourceSummary) => void;
}

function viewToggleStyle(active: boolean) {
  return { border: "none", height: "1.8rem", width: "2rem", background: active ? "var(--surface)" : "transparent" };
}

export function ProjectContextToolbar(props: ProjectContextToolbarProps) {
  return (
    <div className="section-head files-toolbar">
      <div className="files-toolbar-left">
        <button className="btn ghost icon-btn" type="button" disabled={props.parentPath === null || props.isLoading} onClick={() => props.onNavigate(props.parentPath ?? "")} title="Up">
          <ArrowUp size={18} />
        </button>
        <button className="btn ghost icon-btn" onClick={() => props.onNavigate("")} disabled={props.isLoading} title="Context root">
          <Home size={18} />
        </button>
        <div className="files-toolbar-divider" />
        <div className="project-context-title-block">
          <div className="muted-text project-context-path">
            <span>{props.cwd || "Context files"}</span>
          </div>
        </div>
      </div>

      <div className="row-actions files-toolbar-actions">
        <div className="project-context-view-toggle">
          <button className={`btn ghost icon-btn ${props.viewMode === "list" ? "active" : ""}`} onClick={() => props.onViewModeChange("list")} style={viewToggleStyle(props.viewMode === "list")} title="List view">
            <ListIcon size={16} />
          </button>
          <button className={`btn ghost icon-btn ${props.viewMode === "grid" ? "active" : ""}`} onClick={() => props.onViewModeChange("grid")} style={viewToggleStyle(props.viewMode === "grid")} title="Grid view">
            <Grid size={16} />
          </button>
        </div>
        {props.selectedCount > 0 ? <span className="muted-text project-context-selection-copy">{props.selectedCount} selected</span> : null}
        <button className="btn ghost danger-outline" type="button" disabled={props.selectedCount === 0} onClick={props.onRemoveSelected}>
          <Trash2 size={14} />
          Remove
        </button>
        <AttachFilesMenu
          variant="button"
          buttonLabel="Attach files"
          popoverPlacement="bottom-end"
          disabled={props.isUploading}
          isBusy={props.isUploading}
          onUploadFiles={props.onUploadFiles}
          onUploadFolder={props.onUploadFiles}
          onCreateTextFile={props.onCreateTextFile}
          sourceActions={props.sources.map((source) => ({
            id: source.id,
            label: source.name,
            onSelect: () => props.onAttachFromSource(source)
          }))}
        />
      </div>
    </div>
  );
}
