import { useState } from "react";
import { ExternalLink, FolderOpen, MessageSquare, RotateCw, X } from "lucide-react";
import type { CanvasDocumentKind } from "@meowbert/shared/canvas-frame";
import { CanvasViewportControls, type PanelViewport } from "./CanvasViewportControls";
import { CanvasComments } from "./CanvasComments";
import { useCanvasComments } from "./useCanvasComments";
import { CanvasFrame } from "./CanvasFrame";
import { CanvasSelectButton, CanvasSelectionPrompt } from "./CanvasSelectionControls";
import { buildCanvasSelectionPrompt } from "./canvasSelectionPrompt";
import { useCanvasSelection } from "./useCanvasSelection";
import type { CanvasHost } from "./CanvasHostContext";
import {
  buildCanvasFixPrompt,
  getCanvasStorageKey,
  getCanvasViewKey,
  getCanvasViewTitle,
  type CanvasView
} from "./canvasViews";

function CanvasCommentsButton(props: { open: boolean; count: number; onClick: () => void }) {
  return (
    <button type="button" className={`icon-btn canvas-comments-toggle${props.open ? " active" : ""}`} title="Comments"
      aria-label="Comments" aria-pressed={props.open} onClick={props.onClick}>
      <MessageSquare size={14} aria-hidden="true" />
      {props.count ? <span className="canvas-comments-badge" aria-hidden="true">{props.count > 9 ? "9+" : props.count}</span> : null}
    </button>
  );
}

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
  const [documentFit, setDocumentFit] = useState(true);
  const [kind, setKind] = useState<{ key: string; kind: CanvasDocumentKind } | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [documentPath, setDocumentPath] = useState<{ key: string; path: string } | null>(null);
  const { host, activeView } = props;
  const source = host.resolveSource(activeView);
  const sendPrompt = host.sendPrompt;
  const reloadToken = host.reloadTokenFor(activeView) + reloadNonce;
  const loadKey = `${getCanvasViewKey(activeView)}#${reloadToken}`;
  const pageView = documentPath?.key === loadKey && documentPath.path !== activeView.relativePath
    ? { ...activeView, relativePath: documentPath.path } : activeView;
  const selection = useCanvasSelection(`${getCanvasViewKey(pageView)}#${reloadToken}`);
  const comments = useCanvasComments(host.comments, pageView, reloadToken);
  const documentView = kind?.key === getCanvasViewKey(activeView) && kind.kind === "document";
  const commenting = Boolean(host.comments) && selection.enabled && selection.intent === "comment";
  const openComments = comments.items.filter((comment) => !comment.resolved).length;

  async function submitSelection(body: string) {
    const element = selection.element;
    if (!element) return;
    if (selection.intent === "comment") {
      if (await comments.add(element, body)) selection.clearIfSelected(element);
      return;
    }
    sendPrompt?.(buildCanvasSelectionPrompt(pageView.relativePath, element, body));
    selection.clear();
  }

  return (
    <section className="canvas-panel" aria-label="Canvas">
      <header className="canvas-panel-header">
        <CanvasPanelTabs views={props.views} activeKey={getCanvasViewKey(activeView)} onSelect={props.onSelect} />
        <div className="canvas-panel-actions">
          {sendPrompt ? <CanvasSelectButton active={selection.enabled && selection.intent === "ask"} onClick={() => selection.toggle("ask")} disabled={!source} /> : null}
          {host.comments ? <CanvasCommentsButton open={commentsOpen} count={openComments} onClick={() => setCommentsOpen(!commentsOpen)} /> : null}
          <CanvasViewportControls document={documentView} fit={documentFit} onFit={setDocumentFit} viewport={viewport} onViewport={setViewport} />
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
      <div className={`canvas-panel-body viewport-${documentView ? "desktop" : viewport}`}>
        {source ? (
          <CanvasFrame
            src={source.src}
            srcKey={source.srcKey}
            title={getCanvasViewTitle(activeView)}
            storageKey={getCanvasStorageKey(activeView, host.taskId)}
            sizing={{ mode: "fill" }}
            reloadToken={reloadToken}
            selectionEnabled={selection.enabled}
            onElementSelect={selection.select}
            documentFit={documentFit}
            relativePath={activeView.relativePath}
            onDocumentPath={(path) => setDocumentPath((current) => current?.key === loadKey && current.path === path ? current : { key: loadKey, path })}
            onDocumentKind={(nextKind) => setKind({ key: getCanvasViewKey(activeView), kind: nextKind })}
            onRunRequest={sendPrompt ? (request) => sendPrompt(request.prompt) : undefined}
            onFixRequest={sendPrompt ? (errors) => sendPrompt(buildCanvasFixPrompt(pageView, errors)) : undefined}
          />
        ) : (
          <div className="canvas-card-unavailable">Loading canvas…</div>
        )}
      </div>
      <div className="canvas-panel-footer">
        {commentsOpen && host.comments ? <CanvasComments items={comments.items} pending={comments.pending} error={comments.error}
          adding={commenting} onAdd={() => selection.toggle("comment")} onClose={() => setCommentsOpen(false)}
          onResolve={(id, resolved) => { void comments.resolve(id, resolved); }}
          onAsk={sendPrompt ? (comment) => sendPrompt(buildCanvasSelectionPrompt(comment.relativePath, comment.element, comment.body)) : undefined} /> : null}
        {selection.enabled && (commenting || sendPrompt) ? (
          <CanvasSelectionPrompt key={`${selection.intent}:${selection.element?.selector ?? "pick"}`} intent={selection.intent}
            element={selection.element} onDismiss={selection.clear} pending={commenting && comments.pending}
            onSubmit={(body) => { void submitSelection(body); }} />
        ) : null}
      </div>
    </section>
  );
}
