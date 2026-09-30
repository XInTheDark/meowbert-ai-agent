import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, File, Loader2, Palette } from "lucide-react";
import { FilePreviewBody } from "../../../components/files/FilePreviewBody";
import type { ApiClient } from "../../../lib/api";
import type { EnvironmentFileEntry, ProjectCanvasSummary, TaskArtifact } from "../../../lib/types";
import { formatBytes } from "../../../lib/utils";
import { TaskCanvasArtifactPreview } from "./TaskCanvasArtifactPreview";
import { useTaskArtifactPreview } from "./useTaskArtifactPreview";

interface TaskDetailArtifactsPaneProps {
  api: ApiClient;
  token: string | null;
  projectId: string | null;
  taskRootPath: string | null;
  artifacts: TaskArtifact[];
  canvases: ProjectCanvasSummary[];
  isDownloadingArtifact?: boolean;
  onDownloadArtifact: (relativePath: string) => void;
  onOpenCanvas: (canvasId: string) => void;
}

type ArtifactListEntry =
  | { key: string; kind: "file"; createdAt: string; artifact: TaskArtifact }
  | { key: string; kind: "canvas"; createdAt: string; canvas: ProjectCanvasSummary };

function getArtifactName(relativePath: string): string {
  return relativePath.split("/").filter(Boolean).pop() ?? relativePath;
}

function toFileEntry(artifact: TaskArtifact): EnvironmentFileEntry {
  return {
    name: getArtifactName(artifact.relative_path),
    relativePath: artifact.relative_path,
    kind: "file",
    sizeBytes: artifact.size_bytes,
    createdAt: artifact.created_at,
    modifiedAt: artifact.created_at
  };
}

function TaskArtifactList(props: {
  entries: ArtifactListEntry[];
  selectedEntryKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <nav className="task-artifacts-list" aria-label="Artifacts">
      {props.entries.map((entry) => {
        const isSelected = entry.key === props.selectedEntryKey;
        const isCanvas = entry.kind === "canvas";
        const title = isCanvas ? entry.canvas.name : getArtifactName(entry.artifact.relative_path);
        const detail = isCanvas
          ? `Interactive canvas · ${entry.canvas.runtimeMode === "dev_server" ? "Dev server" : "Static"}`
          : entry.artifact.relative_path;
        return (
          <button
            key={entry.key}
            type="button"
            className={`task-artifact-row${isSelected ? " selected" : ""}`}
            onClick={() => props.onSelect(entry.key)}
            aria-pressed={isSelected}
          >
            {isCanvas ? <Palette size={16} aria-hidden="true" /> : <File size={16} aria-hidden="true" />}
            <span className="task-artifact-row-copy">
              <strong>{title}</strong>
              <span className="muted-text" title={detail}>{detail}</span>
            </span>
            {isCanvas ? null : (
              <span className="muted-text task-artifact-size">{formatBytes(entry.artifact.size_bytes)}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function TaskDetailArtifactsPane(props: TaskDetailArtifactsPaneProps) {
  const entries = useMemo<ArtifactListEntry[]>(() => [
    ...props.artifacts.map((artifact) => ({
      key: `file:${artifact.id}`,
      kind: "file" as const,
      createdAt: artifact.created_at,
      artifact
    })),
    ...props.canvases.map((canvas) => ({
      key: `canvas:${canvas.id}`,
      kind: "canvas" as const,
      createdAt: canvas.createdAt,
      canvas
    }))
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [props.artifacts, props.canvases]);
  const [selectedEntryKey, setSelectedEntryKey] = useState<string | null>(entries[0]?.key ?? null);
  const selectedItem = entries.find((entry) => entry.key === selectedEntryKey) ?? null;
  const selectedArtifact = selectedItem?.kind === "file" ? selectedItem.artifact : null;
  const selectedCanvas = selectedItem?.kind === "canvas" ? selectedItem.canvas : null;
  const selectedEntry = useMemo(
    () => selectedArtifact ? toFileEntry(selectedArtifact) : null,
    [selectedArtifact]
  );
  const artifactPreview = useTaskArtifactPreview({
    api: props.api,
    projectId: props.projectId,
    taskRootPath: props.taskRootPath,
    entry: selectedEntry
  });

  useEffect(() => {
    if (entries.some((entry) => entry.key === selectedEntryKey)) {
      return;
    }
    setSelectedEntryKey(entries[0]?.key ?? null);
  }, [entries, selectedEntryKey]);

  if (entries.length === 0) {
    return (
      <div className="page-content task-tab-pane task-artifacts-empty">
        <File size={22} aria-hidden="true" />
        <p>No artifacts yet.</p>
      </div>
    );
  }

  return (
    <div className="task-tab-pane task-artifacts-pane">
      <TaskArtifactList
        entries={entries}
        selectedEntryKey={selectedEntryKey}
        onSelect={setSelectedEntryKey}
      />

      <section className="task-artifact-preview" aria-label="Artifact preview">
        <header className="task-artifact-preview-header">
          <div className="task-artifact-preview-title">
            <strong>{selectedCanvas?.name ?? selectedEntry?.name}</strong>
            <span className="muted-text">
              {selectedCanvas ? "Interactive canvas" : selectedArtifact?.relative_path}
            </span>
          </div>
          {selectedCanvas ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => props.onOpenCanvas(selectedCanvas.id)}
            >
              <ExternalLink size={15} />
              Open canvas
            </button>
          ) : selectedArtifact ? (
            <button
              type="button"
              className="btn ghost icon-btn"
              title={props.isDownloadingArtifact ? "Preparing download..." : "Download"}
              aria-label={props.isDownloadingArtifact ? "Preparing download" : `Download ${selectedEntry?.name ?? "artifact"}`}
              disabled={props.isDownloadingArtifact}
              onClick={() => props.onDownloadArtifact(selectedArtifact.relative_path)}
            >
              {props.isDownloadingArtifact ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
            </button>
          ) : null}
        </header>
        <div className={`task-artifact-preview-body${selectedCanvas ? " canvas" : ""}`}>
          {selectedCanvas ? (
            <TaskCanvasArtifactPreview
              canvas={selectedCanvas}
              projectId={props.projectId}
              token={props.token}
            />
          ) : artifactPreview.error ? (
            <div className="empty-hint task-artifact-preview-message">
              <p>{artifactPreview.error}</p>
              <p className="muted-text">Download the file to inspect it locally.</p>
            </div>
          ) : (
            <FilePreviewBody
              entry={selectedEntry}
              preview={artifactPreview.preview}
              isLoading={artifactPreview.isLoading}
              previewDownloadUrl={artifactPreview.downloadUrl}
              previewToken={props.token}
            />
          )}
        </div>
      </section>
    </div>
  );
}
