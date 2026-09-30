import { Download, Loader2, NotebookPen, X } from "lucide-react";
import type { ProjectFileEntry, ProjectFilePreview } from "../../../lib/types";
import { FilePreviewBody } from "../../../components/files/FilePreviewBody";

interface ProjectContextPreviewPaneProps {
  selectedEntry: ProjectFileEntry | null;
  selectedCount: number;
  filePreview: ProjectFilePreview | null;
  isLoadingPreview?: boolean;
  isDownloading?: boolean;
  previewDownloadUrl?: string | null;
  previewToken?: string | null;
  onDownload?: (relativePath: string) => void;
  onEditNote?: () => void;
  onClose: () => void;
}

export function ProjectContextPreviewPane(props: ProjectContextPreviewPaneProps) {
  if (props.selectedCount !== 1 || !props.selectedEntry) {
    return null;
  }

  return (
    <div className="file-preview-pane">
      <div className="project-context-preview-header">
        <div className="project-context-preview-header-copy">
          <span className="project-context-preview-title">Preview</span>
          <span className="project-context-preview-path" title={props.selectedEntry.relativePath}>
            {props.selectedEntry.name}
          </span>
        </div>
        <div className="project-context-preview-actions">
          {typeof props.onEditNote === "function" ? (
            <button
              className="btn ghost icon-btn"
              type="button"
              title={props.selectedEntry.note ? "Edit note" : "Add note"}
              style={{ width: "1.8rem", height: "1.8rem" }}
              onClick={() => props.onEditNote?.()}
            >
              <NotebookPen size={14} />
            </button>
          ) : null}
          {typeof props.onDownload === "function" ? (
            <button
              className="btn ghost icon-btn"
              type="button"
              title={props.isDownloading ? "Preparing download..." : "Download"}
              aria-label={props.isDownloading ? "Preparing download" : "Download"}
              disabled={props.isDownloading}
              style={{ width: "1.8rem", height: "1.8rem" }}
              onClick={() => props.onDownload?.(props.selectedEntry!.relativePath)}
            >
              {props.isDownloading ? <Loader2 className="spin" size={14} /> : <Download size={14} />}
            </button>
          ) : null}
          <button
            className="btn ghost icon-btn"
            onClick={props.onClose}
            title="Close preview"
            style={{ width: "1.8rem", height: "1.8rem" }}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="project-context-preview-body">
        <section className="project-context-note-card">
          <div className="project-context-note-title">Context note</div>
          <div className="muted-text project-context-note-copy">
            {props.selectedEntry.note?.trim().length
              ? props.selectedEntry.note
              : "No note yet. Add one to explain why this file matters or how the agent should use it."}
          </div>
        </section>
        <FilePreviewBody
          entry={props.selectedEntry}
          preview={props.filePreview}
          isLoading={props.isLoadingPreview}
          previewDownloadUrl={props.previewDownloadUrl}
          previewToken={props.previewToken}
        />
      </div>
    </div>
  );
}
