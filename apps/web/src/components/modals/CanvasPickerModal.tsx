import { useEffect, useMemo, useState } from "react";
import { AppWindow, Paperclip, Search, X } from "lucide-react";
import type { ApiClient } from "../../lib/api";
import { InlineProgressBar } from "../InlineProgressBar";
import type { ProjectCanvasListResponse, ProjectCanvasSummary, TaskAttachment } from "../../lib/types";
import { formatRelative } from "../../lib/utils";

interface CanvasPickerModalProps {
  api: ApiClient;
  projectId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onAttach: (attachment: TaskAttachment) => void;
  onOpenInCanvasMode?: (canvas: ProjectCanvasSummary) => void;
}

function toCanvasAttachment(canvas: ProjectCanvasSummary): TaskAttachment {
  return {
    id: crypto.randomUUID(),
    kind: "canvas",
    label: canvas.name,
    content: `Canvas: ${canvas.name}`,
    relativePath: canvas.rootPath
  };
}

export function CanvasPickerModal(props: CanvasPickerModalProps) {
  const [canvases, setCanvases] = useState<ProjectCanvasSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? canvases.filter((canvas) => canvas.name.toLowerCase().includes(needle)) : canvases;
  }, [canvases, filter]);

  useEffect(() => {
    if (!props.isOpen || !props.projectId) {
      return;
    }

    setIsLoading(true);
    setFilter("");
    setError(null);
    void props.api.get<ProjectCanvasListResponse>(`/api/projects/${props.projectId}/canvases`)
      .then((response) => setCanvases(response.items))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsLoading(false));
  }, [props.api, props.isOpen, props.projectId]);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.isOpen, props.onClose]);

  if (!props.isOpen) {
    return null;
  }

  function attach(canvas: ProjectCanvasSummary): void {
    props.onAttach(toCanvasAttachment(canvas));
    props.onClose();
  }

  return (
    <div className="environment-file-picker-overlay" onClick={props.onClose}>
      <div className="picker-dialog" role="dialog" aria-modal="true" aria-labelledby="canvas-picker-title"
        onClick={(event) => event.stopPropagation()}>
        <header className="picker-dialog-header">
          <h2 id="canvas-picker-title">Canvases</h2>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </header>
        <label className="picker-dialog-search">
          <Search size={15} aria-hidden="true" />
          <input autoFocus value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search canvases"
            aria-label="Search canvases" onKeyDown={(event) => { if (event.key === "Enter" && visible[0]) attach(visible[0]); }} />
        </label>
        <div className="picker-dialog-list">
          {isLoading ? <InlineProgressBar pin="top" /> : null}
          {error ? <div className="error-banner">{error}</div> : null}
          {!isLoading && !error && visible.length === 0 ? (
            <div className="picker-dialog-empty">{canvases.length === 0 ? "No canvases in this project yet." : "No matching canvases."}</div>
          ) : null}
          {visible.map((canvas) => (
            <div key={canvas.id} className="picker-dialog-row">
              <button type="button" className="picker-dialog-row-main" onClick={() => attach(canvas)} title="Attach to message">
                <span className="picker-dialog-row-icon" aria-hidden="true"><AppWindow size={16} /></span>
                <span className="picker-dialog-row-text">
                  <strong>{canvas.name}</strong>
                  <span>Updated {formatRelative(canvas.updatedAt)}</span>
                </span>
              </button>
              <div className="picker-dialog-row-actions">
                <button type="button" className="icon-btn" onClick={() => attach(canvas)} title="Attach" aria-label={`Attach ${canvas.name}`}>
                  <Paperclip size={15} />
                </button>
                {props.onOpenInCanvasMode ? (
                  <button type="button" className="btn ghost picker-dialog-open" onClick={() => {
                    props.onOpenInCanvasMode?.(canvas);
                    props.onClose();
                  }}>
                    Canvas mode
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
