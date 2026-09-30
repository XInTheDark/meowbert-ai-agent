import { InlineProgressBar } from "../../../components/InlineProgressBar";
import type { ProjectCanvasSummary } from "../../../lib/types";
import { formatRelative } from "../../../lib/utils";

interface ProjectCanvasOverviewTabProps {
  canvases: ProjectCanvasSummary[];
  isLoading: boolean;
  onOpen: (canvasId: string) => void;
  onContinue: (canvasId: string) => void;
}

export function ProjectCanvasOverviewTab(props: ProjectCanvasOverviewTabProps) {
  if (props.isLoading) {
    return (
      <div className="project-canvas-tab">
        <InlineProgressBar pin="top" />
      </div>
    );
  }

  if (props.canvases.length === 0) {
    return <div className="task-list-empty project-canvas-tab">No canvases yet.</div>;
  }

  return (
    <div className="project-canvas-grid project-canvas-tab">
      {props.canvases.map((canvas) => (
        <div key={canvas.id} className="project-canvas-card">
          <div className="project-canvas-card-main">
            <strong>{canvas.name}</strong>
            <span className="muted-text">
              {canvas.runtimeMode === "dev_server" ? "Dev server" : "Static"} · updated {formatRelative(canvas.updatedAt)}
            </span>
          </div>
          <div className="row-actions">
            <button type="button" className="btn ghost" onClick={() => props.onOpen(canvas.id)}>
              Open
            </button>
            <button type="button" className="btn primary" onClick={() => props.onContinue(canvas.id)}>
              Continue
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
