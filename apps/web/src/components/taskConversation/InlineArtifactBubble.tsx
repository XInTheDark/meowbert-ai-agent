import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ExternalLink } from "lucide-react";
import { renderMermaidSvg } from "../../lib/mermaid";
import type { TaskInlineArtifact } from "../../task/taskInlineArtifacts";

interface InlineArtifactBubbleProps {
  messageId: string;
  artifact: TaskInlineArtifact;
  src: string | null;
}

const DEFAULT_INLINE_ARTIFACT_WIDTH = 860;
const DEFAULT_INLINE_ARTIFACT_SCALE = 1;
const MIN_INLINE_ARTIFACT_SCALE = 0.5;
const MAX_INLINE_ARTIFACT_SCALE = 2.0;
const INLINE_ARTIFACT_SCALE_STEP = 0.05;
type PreviewStatus = "loading" | "ready" | "error";

export function InlineArtifactBubble(props: InlineArtifactBubbleProps) {
  const [committedScale, setCommittedScale] = useState(DEFAULT_INLINE_ARTIFACT_SCALE);
  const [draftScale, setDraftScale] = useState(DEFAULT_INLINE_ARTIFACT_SCALE);
  const isDraggingScaleRef = useRef(false);
  const zoomLabelId = useId();
  const baseWidth = props.artifact.width ?? DEFAULT_INLINE_ARTIFACT_WIDTH;
  const previewWidth = Math.round(baseWidth * committedScale);
  const height = Math.round((props.artifact.height ?? 520) * committedScale);
  const title = props.artifact.title ?? "Inline artifact";
  const artifactLabel = props.artifact.type === "image"
    ? "Image"
    : props.artifact.type === "mermaid"
      ? "Mermaid"
      : "HTML";

  function updateDraftScale(nextScale: number): void {
    setDraftScale(nextScale);
    if (!isDraggingScaleRef.current) {
      setCommittedScale(nextScale);
    }
  }

  function commitScale(nextScale: number): void {
    isDraggingScaleRef.current = false;
    setDraftScale(nextScale);
    setCommittedScale(nextScale);
  }

  function startDraggingScale(): void {
    isDraggingScaleRef.current = true;
  }

  return (
    <div
      className="chat-bubble assistant inline-artifact-bubble"
      data-message-id={props.messageId}
      style={{
        "--inline-artifact-scale": String(committedScale),
        "--inline-artifact-base-width": `${baseWidth}px`,
        "--inline-artifact-preview-width": `${previewWidth}px`
      } as CSSProperties}
    >
      <div className="bubble-content">
        <div className="inline-artifact-toolbar">
          <div className="inline-artifact-header">
            <strong className="inline-artifact-title">{title}</strong>
            <span className="inline-artifact-path" title={props.artifact.relativePath}>
              {props.artifact.relativePath}
            </span>
          </div>
          <div className="inline-artifact-controls" aria-label="Inline artifact controls">
            {props.src ? (
              <a
                className="inline-artifact-open-raw"
                href={props.src}
                target="_blank"
                rel="noreferrer"
                title="Open raw artifact in a new tab"
                aria-label={`Open raw ${artifactLabel.toLowerCase()} artifact in a new tab`}
              >
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : null}
            <label className="inline-artifact-scale-slider" htmlFor={zoomLabelId}>
              <span className="inline-artifact-scale-caption">Zoom</span>
              <input
                id={zoomLabelId}
                type="range"
                min={MIN_INLINE_ARTIFACT_SCALE}
                max={MAX_INLINE_ARTIFACT_SCALE}
                step={INLINE_ARTIFACT_SCALE_STEP}
                value={draftScale}
                aria-label="Canvas zoom"
                onChange={(event) => updateDraftScale(Number(event.target.value))}
                onPointerDown={startDraggingScale}
                onPointerUp={(event) => commitScale(Number(event.currentTarget.value))}
                onMouseDown={startDraggingScale}
                onMouseUp={(event) => commitScale(Number(event.currentTarget.value))}
                onTouchStart={startDraggingScale}
                onTouchEnd={(event) => commitScale(Number(event.currentTarget.value))}
                onBlur={(event) => {
                  if (isDraggingScaleRef.current) {
                    commitScale(Number(event.currentTarget.value));
                  }
                }}
              />
            </label>
            <output className="inline-artifact-scale-label" aria-live="polite">
              {Math.round(draftScale * 100)}%
            </output>
          </div>
        </div>
        {props.artifact.description ? (
          <p className="inline-artifact-description">{props.artifact.description}</p>
        ) : null}
        <InlineArtifactPreviewStage
          artifact={props.artifact}
          artifactLabel={artifactLabel}
          height={height}
          src={props.src}
          title={title}
        />
      </div>
    </div>
  );
}

function InlineArtifactPreviewStage(props: {
  artifact: TaskInlineArtifact;
  artifactLabel: string;
  height: number;
  src: string | null;
  title: string;
}): JSX.Element {
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>(props.src ? "loading" : "error");
  const [previewError, setPreviewError] = useState<string | null>(
    props.src ? null : "Inline preview is unavailable in this view."
  );
  const [mermaidSvg, setMermaidSvg] = useState<string | null>(null);

  useEffect(() => {
    if (!props.src) {
      setPreviewStatus("error");
      setPreviewError("Inline preview is unavailable in this view.");
      setMermaidSvg(null);
      return;
    }

    setPreviewStatus("loading");
    setPreviewError(null);
    if (props.artifact.type !== "mermaid") {
      setMermaidSvg(null);
      return;
    }

    const controller = new AbortController();
    void fetch(props.src, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const renderedSvg = await renderMermaidSvg(await response.text(), "default");
        if (!controller.signal.aborted) {
          setMermaidSvg(renderedSvg);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPreviewStatus("error");
          setPreviewError(error instanceof Error ? error.message : "Could not load diagram.");
        }
      });

    return () => controller.abort();
  }, [props.artifact.type, props.src]);

  if (!props.src) {
    return (
      <div className="inline-artifact-unavailable">
        {previewError ?? "Inline preview is unavailable in this view."}
      </div>
    );
  }

  function markPreviewReady(): void {
    setPreviewStatus("ready");
    setPreviewError(null);
  }

  function markPreviewError(message: string): void {
    setPreviewStatus("error");
    setPreviewError(message);
  }

  return (
    <div
      className={`inline-artifact-stage ${previewStatus === "loading" ? "loading" : ""}`}
      aria-busy={previewStatus === "loading"}
    >
      <InlineArtifactPreviewContent
        artifact={props.artifact}
        height={props.height}
        mermaidSvg={mermaidSvg}
        onError={markPreviewError}
        onReady={markPreviewReady}
        src={props.src}
        title={props.title}
      />
      {previewStatus !== "ready" ? (
        <div
          className="inline-artifact-preview-status"
          role={previewStatus === "error" ? "alert" : "status"}
        >
          {previewStatus === "error"
            ? previewError ?? `Could not load ${props.artifactLabel.toLowerCase()} preview.`
            : `Loading ${props.artifactLabel.toLowerCase()} preview...`}
        </div>
      ) : null}
    </div>
  );
}

function InlineArtifactPreviewContent(props: {
  artifact: TaskInlineArtifact;
  height: number;
  mermaidSvg: string | null;
  onError: (message: string) => void;
  onReady: () => void;
  src: string;
  title: string;
}): JSX.Element | null {
  if (props.artifact.type === "image") {
    return (
      <img
        key={props.src}
        className="inline-artifact-image"
        src={props.src}
        alt={props.title}
        onLoad={props.onReady}
        onError={() => props.onError("Could not load image preview.")}
        style={{ maxHeight: props.height }}
      />
    );
  }

  if (props.artifact.type === "mermaid") {
    if (props.mermaidSvg === null) {
      return null;
    }

    return (
      <iframe
        key={`${props.src}:mermaid`}
        className="inline-artifact-frame"
        srcDoc={buildMermaidArtifactHtml(props.mermaidSvg)}
        title={props.title}
        sandbox=""
        loading="eager"
        onLoad={props.onReady}
        onError={() => props.onError("Could not render Mermaid diagram.")}
        style={{ height: props.height }}
      />
    );
  }

  return (
    <iframe
      key={props.src}
      className="inline-artifact-frame"
      src={props.src}
      title={props.title}
      sandbox="allow-downloads allow-scripts"
      loading="eager"
      onLoad={props.onReady}
      onError={() => props.onError("Could not load HTML preview.")}
      style={{ height: props.height }}
    />
  );
}

function buildMermaidArtifactHtml(svg: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; min-height: 100%; background: white; }
      body { display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
      .mermaid { width: 100%; text-align: center; }
      svg { max-width: 100%; height: auto; }
    </style>
  </head>
  <body>
    <div class="mermaid">${svg}</div>
  </body>
</html>`;
}
