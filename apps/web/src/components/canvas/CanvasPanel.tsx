import { useState } from "react";
import { ExternalLink, FolderOpen, Monitor, RotateCw, Smartphone, Tablet, X } from "lucide-react";
import { CanvasFrame } from "./CanvasFrame";
import type { CanvasHost } from "./CanvasHostContext";
import {
  buildCanvasFixPrompt,
  getCanvasStorageKey,
  getCanvasViewKey,
  getCanvasViewTitle,
  type CanvasView
} from "./canvasViews";

type PanelViewport = "desktop" | "tablet" | "phone";

const VIEWPORTS: Array<{ id: PanelViewport; label: string; icon: JSX.Element }> = [
  { id: "desktop", label: "Full width", icon: <Monitor size={14} aria-hidden="true" /> },
  { id: "tablet", label: "Tablet width", icon: <Tablet size={14} aria-hidden="true" /> },
  { id: "phone", label: "Phone width", icon: <Smartphone size={14} aria-hidden="true" /> }
];

function CanvasPanelTabs(props: { views: CanvasView[]; activeKey: string; onSelect: (view: CanvasView) => void }) {
  if (props.views.length < 2) {
    const view = props.views[0];
    return <strong className="canvas-panel-title" title={view?.relativePath}>{view ? getCanvasViewTitle(view) : "Canvas"}</strong>;
  }
  return (
    <div className="canvas-panel-tabs" role="tablist" aria-label="Canvases">
      {props.views.map((view) => {
        const key = getCanvasViewKey(view);
        return (
          <button key={key} type="button" role="tab" aria-selected={key === props.activeKey} title={view.relativePath}
            className={key === props.activeKey ? "active" : ""} onClick={() => props.onSelect(view)}>
            {getCanvasViewTitle(view)}
          </button>
        );
      })}
    </div>
  );
}

/** The canvas viewer beside the conversation: full-height page with viewport, reload and file controls. */
export function CanvasPanel(props: {
  host: CanvasHost;
  views: CanvasView[];
  activeView: CanvasView;
  onSelect: (view: CanvasView) => void;
  onClose: () => void;
  onOpenFiles?: (view: CanvasView) => void;
}) {
  const [viewport, setViewport] = useState<PanelViewport>("desktop");
  const [reloadNonce, setReloadNonce] = useState(0);
  const { host, activeView } = props;
  const source = host.resolveSource(activeView);
  const sendPrompt = host.sendPrompt;

  return (
    <section className="canvas-panel" aria-label="Canvas">
      <header className="canvas-panel-header">
        <CanvasPanelTabs views={props.views} activeKey={getCanvasViewKey(activeView)} onSelect={props.onSelect} />
        <div className="canvas-panel-actions">
          <div className="canvas-panel-viewports" role="group" aria-label="Preview width">
            {VIEWPORTS.map((option) => (
              <button key={option.id} type="button" className={`icon-btn${viewport === option.id ? " active" : ""}`}
                onClick={() => setViewport(option.id)} title={option.label} aria-label={option.label} aria-pressed={viewport === option.id}>
                {option.icon}
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn" onClick={() => setReloadNonce((value) => value + 1)} title="Reload" aria-label="Reload">
            <RotateCw size={14} aria-hidden="true" />
          </button>
          {props.onOpenFiles ? (
            <button type="button" className="icon-btn" onClick={() => props.onOpenFiles?.(activeView)} title="Files" aria-label="Files">
              <FolderOpen size={14} aria-hidden="true" />
            </button>
          ) : null}
          {source ? (
            <a className="icon-btn" href={source.src} target="_blank" rel="noreferrer" title="Open in a new tab" aria-label="Open in a new tab">
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : null}
          <button type="button" className="icon-btn" onClick={props.onClose} title="Close" aria-label="Close canvas">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className={`canvas-panel-body viewport-${viewport}`}>
        {source ? (
          <CanvasFrame
            src={source.src}
            srcKey={source.srcKey}
            title={getCanvasViewTitle(activeView)}
            storageKey={getCanvasStorageKey(activeView, host.taskId)}
            sizing={{ mode: "fill" }}
            reloadToken={host.reloadTokenFor(activeView) + reloadNonce}
            onRunRequest={sendPrompt ? (request) => sendPrompt(request.prompt) : undefined}
            onFixRequest={sendPrompt ? (errors) => sendPrompt(buildCanvasFixPrompt(activeView, errors)) : undefined}
          />
        ) : (
          <div className="canvas-card-unavailable">Loading canvas…</div>
        )}
      </div>
    </section>
  );
}
