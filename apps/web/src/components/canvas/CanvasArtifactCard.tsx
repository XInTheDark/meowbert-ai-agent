import { useEffect, useState } from "react";
import { AppWindow, ExternalLink, Maximize2, RotateCw } from "lucide-react";
import type { InlineArtifact } from "@meowbert/shared/inline-artifacts";
import { MermaidDiagram } from "../taskConversation/MermaidDiagram";
import { CanvasFrame } from "./CanvasFrame";
import { useCanvasHost, type CanvasHost } from "./CanvasHostContext";
import {
  buildCanvasFixPrompt,
  canvasViewFromArtifact,
  getCanvasStorageKey,
  getCanvasViewTitle,
  type CanvasView
} from "./canvasViews";

const INLINE_MIN_HEIGHT = 120;

// Tall inline pages stop growing at most of the screen and scroll inside.
function inlineMaxHeight(): number {
  return typeof window === "undefined" ? 900 : Math.round(window.innerHeight * 0.75);
}

function CanvasUnavailable(props: { label: string }) {
  return <div className="canvas-card-unavailable">{props.label}</div>;
}

function CanvasInlineCard(props: { view: CanvasView; host: CanvasHost; source: { src: string; srcKey: string } }) {
  const { view, host, source } = props;
  const [reloadNonce, setReloadNonce] = useState(0);
  const title = getCanvasViewTitle(view);
  const sendPrompt = host.sendPrompt;
  return (
    <figure className="canvas-card canvas-card-inline">
      <div className="canvas-card-stage">
        <CanvasFrame
          src={source.src}
          srcKey={source.srcKey}
          title={title}
          storageKey={getCanvasStorageKey(view, host.taskId)}
          sizing={view.height
            ? { mode: "fixed", height: view.height }
            : { mode: "auto", minHeight: INLINE_MIN_HEIGHT, maxHeight: inlineMaxHeight() }}
          reloadToken={host.reloadTokenFor(view) + reloadNonce}
          onRunRequest={sendPrompt ? (request) => sendPrompt(request.prompt) : undefined}
          onFixRequest={sendPrompt ? (errors) => sendPrompt(buildCanvasFixPrompt(view, errors)) : undefined}
        />
        <div className="canvas-card-toolbar">
          {host.openInPanel ? (
            <button type="button" className="icon-btn" onClick={() => host.openInPanel?.(view)} title="Open beside the conversation" aria-label="Open beside the conversation">
              <Maximize2 size={14} aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className="icon-btn" onClick={() => setReloadNonce((value) => value + 1)} title="Reload" aria-label="Reload">
            <RotateCw size={14} aria-hidden="true" />
          </button>
          <a className="icon-btn" href={source.src} target="_blank" rel="noreferrer" title="Open in a new tab" aria-label="Open in a new tab">
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
      </div>
      {view.title ? <figcaption>{view.title}</figcaption> : null}
    </figure>
  );
}

function CanvasPanelLauncher(props: { view: CanvasView; host: CanvasHost }) {
  const title = getCanvasViewTitle(props.view);
  return (
    <button type="button" className="canvas-card canvas-card-launcher" onClick={() => props.host.openInPanel?.(props.view)}>
      <AppWindow size={18} aria-hidden="true" />
      <span className="canvas-card-launcher-copy">
        <strong>{title}</strong>
        <span className="muted-text">{props.view.relativePath}</span>
      </span>
      <span className="canvas-card-launcher-action">Open</span>
    </button>
  );
}

function CanvasMermaidCard(props: { src: string }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(props.src, { signal: controller.signal })
      .then((response) => response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(setSource, (cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load diagram.");
      });
    return () => controller.abort();
  }, [props.src]);
  if (error) return <CanvasUnavailable label={`Could not load diagram: ${error}`} />;
  return source === null ? <CanvasUnavailable label="Loading diagram…" /> : <MermaidDiagram source={source} />;
}

/** A canvas the agent showed in its reply: inline page, panel launcher, image or diagram. */
export function CanvasArtifactCard(props: { artifact: InlineArtifact }) {
  const host = useCanvasHost();
  const view = canvasViewFromArtifact(props.artifact);
  const source = host?.resolveSource(view) ?? null;
  if (!host) return <CanvasUnavailable label="Preview is unavailable in this view." />;
  if (view.type === "html" && view.display === "panel" && host.openInPanel) {
    return <CanvasPanelLauncher view={view} host={host} />;
  }
  if (!source) return <CanvasUnavailable label={view.canvasId ? "Loading canvas…" : "Preview is unavailable in this view."} />;
  if (view.type === "image") {
    return (
      <a className="canvas-card canvas-card-image" href={source.src} target="_blank" rel="noreferrer">
        <img src={source.src} alt={getCanvasViewTitle(view)} />
      </a>
    );
  }
  if (view.type === "mermaid") return <div className="canvas-card canvas-card-diagram"><CanvasMermaidCard src={source.src} /></div>;
  return <CanvasInlineCard view={view} host={host} source={source} />;
}
