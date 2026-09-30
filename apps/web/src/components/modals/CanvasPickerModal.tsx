import { useEffect, useState } from "react";
import { Palette, X } from "lucide-react";
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

  useEffect(() => {
    if (!props.isOpen || !props.projectId) {
      return;
    }

    setIsLoading(true);
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

  return (
    <div className="environment-file-picker-overlay" onClick={props.onClose}>
      <div
        className="environment-file-picker-modal canvas-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="environment-file-picker-header">
          <div>
            <h2 id="canvas-picker-title">Canvases</h2>
            <p className="environment-file-picker-subtitle">Attach a project canvas or continue the task in canvas mode.</p>
          </div>
          <button type="button" className="legal-close" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="canvas-picker-list">
          {isLoading ? (
            <InlineProgressBar pin="top" />
          ) : error ? (
            <div className="error-banner">{error}</div>
          ) : canvases.length === 0 ? (
            <div className="task-list-empty">No canvases yet.</div>
          ) : canvases.map((canvas) => (
            <div key={canvas.id} className="canvas-picker-row">
              <div className="canvas-picker-icon" aria-hidden="true">
                <Palette size={16} />
              </div>
              <div className="canvas-picker-main">
                <strong>{canvas.name}</strong>
                <span className="muted-text">{canvas.runtimeMode === "dev_server" ? "Dev server" : "Static"} · updated {formatRelative(canvas.updatedAt)}</span>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    props.onAttach(toCanvasAttachment(canvas));
                    props.onClose();
                  }}
                >
                  Attach
                </button>
                {props.onOpenInCanvasMode ? (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      props.onOpenInCanvasMode?.(canvas);
                      props.onClose();
                    }}
                  >
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
