import type { FormEvent, ReactNode } from "react";
import { ArrowUp, Download, Grid, Home, List as ListIcon, Loader2 } from "lucide-react";
import type { Project } from "../../lib/types";
import { FileViewerUploadMenu } from "./FileViewerUploadMenu";

interface FilesToolbarProps {
  projects: Project[];
  scopeValue: string;
  parentPath: string | null;
  pathInput: string;
  viewMode: "list" | "grid";
  selectedCount: number;
  isLoadingList: boolean;
  isDownloading: boolean;
  storageIndicator: ReactNode;
  extraActions?: ReactNode;
  isUploadMenuOpen: boolean;
  isUploading: boolean;
  onNavigate: (path: string) => void;
  onPathInputChange: (value: string) => void;
  onPathSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onScopeChange: (scopeValue: string) => void;
  onViewModeChange: (mode: "list" | "grid") => void;
  onDownload: () => void;
  onDelete: () => void;
  onUploadMenuToggle: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
}

export function FilesToolbar(props: FilesToolbarProps) {
  return (
    <div className="section-head files-toolbar" data-onboarding-id="files-toolbar">
      <div className="files-toolbar-left">
        <button className="btn ghost icon-btn" type="button" disabled={props.parentPath === null || props.isLoadingList} onClick={() => props.onNavigate(props.parentPath ?? "")} title="Up">
          <ArrowUp size={18} />
        </button>
        <button className="btn ghost icon-btn" type="button" onClick={() => props.onNavigate("")} disabled={props.isLoadingList} title="Root">
          <Home size={18} />
        </button>
        <div className="files-toolbar-divider" />
        <form className="files-path-form" onSubmit={props.onPathSubmit}>
          <input className="files-path-input" value={props.pathInput} onChange={(event) => props.onPathInputChange(event.target.value)} spellCheck={false} placeholder="/" aria-label="Path" disabled={props.isLoadingList} />
          <select className="files-scope-select icon-only" value={props.scopeValue} onChange={(event) => props.onScopeChange(event.target.value)} aria-label="File scope" disabled={props.isLoadingList}>
            <option value="workspace">Workspace</option>
            {props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </form>
      </div>
      <div className="row-actions files-toolbar-actions">
        <FilesViewToggle viewMode={props.viewMode} onViewModeChange={props.onViewModeChange} />
        <span className="muted-text project-files-selection-count">{props.selectedCount > 0 ? `${props.selectedCount} selected` : "No selection"}</span>
        {props.storageIndicator}
        <button className="btn ghost" type="button" disabled={props.selectedCount === 0 || props.isDownloading} onClick={props.onDownload} title={props.isDownloading ? "Preparing download..." : props.selectedCount > 1 ? `Download ${props.selectedCount} selected` : "Download selected"} aria-label={props.isDownloading ? "Preparing download" : "Download selected"}>
          {props.isDownloading ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
        </button>
        <button className="btn ghost danger-outline" type="button" disabled={props.selectedCount === 0} onClick={props.onDelete}>Delete</button>
        {props.extraActions}
        <FileViewerUploadMenu isOpen={props.isUploadMenuOpen} isUploading={props.isUploading} onToggle={props.onUploadMenuToggle} onUploadFiles={props.onUploadFiles} onUploadFolder={props.onUploadFolder} />
      </div>
    </div>
  );
}

function FilesViewToggle(props: Pick<FilesToolbarProps, "viewMode" | "onViewModeChange">) {
  return (
    <div className="project-files-view-toggle">
      <button className={`btn ghost icon-btn ${props.viewMode === "list" ? "active" : ""}`} onClick={() => props.onViewModeChange("list")} title="List View"><ListIcon size={16} /></button>
      <button className={`btn ghost icon-btn ${props.viewMode === "grid" ? "active" : ""}`} onClick={() => props.onViewModeChange("grid")} title="Grid View"><Grid size={16} /></button>
    </div>
  );
}
