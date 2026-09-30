import type { FormEvent } from "react";
import { ArrowUp, Download, Grid, Home, List as ListIcon, Loader2, MoreVertical } from "lucide-react";
import { FileViewerUploadMenu } from "../../../components/files/FileViewerUploadMenu";
import type { Project, StorageSummary } from "../../../lib/types";
import { formatBytes } from "../../../lib/utils";
import type { ProjectFileStorageMetrics } from "./projectFileStorage";

interface ProjectFilesToolbarProps {
  projects: Project[];
  activeProjectId: string;
  parentPath: string | null;
  pathInput: string;
  viewMode: "list" | "grid";
  selectedCount: number;
  isLoadingList: boolean;
  isDownloading: boolean;
  storageSummary: StorageSummary | null;
  storageStatus: "idle" | "loading" | "ready" | "error";
  storageMetrics: ProjectFileStorageMetrics;
  isStorageExpanded: boolean;
  isCleanupMenuOpen: boolean;
  isLoadingCleanup: boolean;
  isUploadMenuOpen: boolean;
  isUploading: boolean;
  onNavigate: (path: string) => void;
  onPathInputChange: (value: string) => void;
  onPathSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onScopeChange: (projectId: string) => void;
  onViewModeChange: (mode: "list" | "grid") => void;
  onStorageRequest: () => void;
  onStorageExpandedChange: (expanded: boolean) => void;
  onDownload: () => void;
  onDelete: () => void;
  onCleanupMenuToggle: () => void;
  onCleanupRequest: () => void;
  onAiCleanupRequest: () => void;
  onUploadMenuToggle: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
}

export function ProjectFilesToolbar(props: ProjectFilesToolbarProps) {
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
          <select className="files-scope-select icon-only" value={props.activeProjectId} onChange={(event) => props.onScopeChange(event.target.value)} aria-label="File scope" disabled={props.isLoadingList}>
            <option value="workspace">Workspace</option>
            {props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </form>
      </div>
      <div className="row-actions files-toolbar-actions">
        <ProjectFilesViewToggle viewMode={props.viewMode} onViewModeChange={props.onViewModeChange} />
        <span className="muted-text project-files-selection-count">{props.selectedCount > 0 ? `${props.selectedCount} selected` : "No selection"}</span>
        <ProjectStorageIndicator {...props} />
        <button className="btn ghost" type="button" disabled={props.selectedCount === 0 || props.isDownloading} onClick={props.onDownload} title={props.isDownloading ? "Preparing download..." : props.selectedCount > 1 ? `Download ${props.selectedCount} selected` : "Download selected"} aria-label={props.isDownloading ? "Preparing download" : "Download selected"}>
          {props.isDownloading ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
        </button>
        <button className="btn ghost danger-outline" type="button" disabled={props.selectedCount === 0} onClick={props.onDelete}>Delete</button>
        <ProjectCleanupMenu {...props} />
        <FileViewerUploadMenu isOpen={props.isUploadMenuOpen} isUploading={props.isUploading} onToggle={props.onUploadMenuToggle} onUploadFiles={props.onUploadFiles} onUploadFolder={props.onUploadFolder} />
      </div>
    </div>
  );
}

function ProjectFilesViewToggle(props: Pick<ProjectFilesToolbarProps, "viewMode" | "onViewModeChange">) {
  return (
    <div className="project-files-view-toggle">
      <button className={`btn ghost icon-btn ${props.viewMode === "list" ? "active" : ""}`} onClick={() => props.onViewModeChange("list")} title="List View"><ListIcon size={16} /></button>
      <button className={`btn ghost icon-btn ${props.viewMode === "grid" ? "active" : ""}`} onClick={() => props.onViewModeChange("grid")} title="Grid View"><Grid size={16} /></button>
    </div>
  );
}

function ProjectStorageIndicator(props: ProjectFilesToolbarProps) {
  const warning = props.storageSummary?.isOverLimit === true;
  if (props.storageStatus === "loading") {
    return <span className="context-usage-pill project-storage-loading" title="Checking storage..." aria-label="Checking storage"><Loader2 className="spin" size={14} /></span>;
  }
  if (props.storageStatus !== "ready") {
    return <button className={`context-usage-pill ${props.storageStatus === "error" ? "warning" : ""}`} type="button" onClick={props.onStorageRequest} title={props.storageStatus === "error" ? "Retry storage summary" : "Load storage summary"} aria-label={props.storageStatus === "error" ? "Retry storage summary" : "Load storage summary"}>?%</button>;
  }
  if (!props.storageMetrics.hasLimit || props.storageMetrics.usagePercent === null) {
    return <span className={`muted-text project-storage-label${warning ? " warning" : ""}`} title={props.storageMetrics.label}>{props.storageMetrics.label}</span>;
  }
  if (!props.isStorageExpanded) {
    return <button className={`context-usage-pill ${props.storageMetrics.usagePercent >= 80 || warning ? "warning" : ""}`} type="button" onClick={() => props.onStorageExpandedChange(true)} title={props.storageMetrics.tooltip}>{props.storageMetrics.usagePercent}%</button>;
  }
  return (
    <div className={`context-usage-chip project-storage-expanded ${props.storageMetrics.usagePercent >= 80 || warning ? "warning" : ""}`} onClick={() => props.onStorageExpandedChange(false)} title="Click to collapse">
      <div className="context-usage-label">Storage {formatBytes(props.storageMetrics.usedBytes)} / {formatBytes(props.storageMetrics.limitBytes)} ({props.storageMetrics.usagePercent}%)</div>
      {props.storageMetrics.remainingBytes !== null ? <div className={`muted-text project-storage-remaining${warning ? " warning" : ""}`}>{props.storageMetrics.remainingBytes >= 0 ? `${formatBytes(props.storageMetrics.remainingBytes)} free` : `${formatBytes(Math.abs(props.storageMetrics.remainingBytes))} over limit`}</div> : null}
      <div className="context-usage-meter"><span className={warning ? "warning" : ""} style={{ width: `${props.storageMetrics.meterPercent}%` }} /></div>
    </div>
  );
}

function ProjectCleanupMenu(props: ProjectFilesToolbarProps) {
  return (
    <div className="topbar-dropdown" onClick={(event) => event.stopPropagation()}>
      <button className="btn ghost icon-btn" type="button" aria-label="Cleanup actions" aria-haspopup="menu" aria-expanded={props.isCleanupMenuOpen} title="Cleanup actions" onClick={props.onCleanupMenuToggle}><MoreVertical size={16} /></button>
      {props.isCleanupMenuOpen ? (
        <div className="topbar-dropdown-menu">
          <button type="button" onClick={props.onCleanupRequest} disabled={props.isLoadingCleanup}>{props.isLoadingCleanup ? <Loader2 className="spin" size={14} /> : null}Cleanup</button>
          <button type="button" onClick={props.onAiCleanupRequest}>AI Cleanup (Beta)</button>
        </div>
      ) : null}
    </div>
  );
}
