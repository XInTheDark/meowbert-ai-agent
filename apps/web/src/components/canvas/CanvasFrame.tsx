import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CANVAS_FRAME_SANDBOX, type CanvasElementSelection, type CanvasFrameError } from "@meowbert/shared/canvas-frame";
import { useCanvasTheme } from "./canvasFrameTheme";
import { CanvasFrameIssues, CanvasFrameNotice, CanvasRunRequestBar } from "./CanvasFrameOverlays";
import { useCanvasFrameBridge, type CanvasRunRequest } from "./useCanvasFrameBridge";

export type CanvasFrameSizing =
  | { mode: "auto"; minHeight: number; maxHeight: number }
  | { mode: "fixed"; height: number }
  | { mode: "fill" };

export interface CanvasFrameProps {
  src: string;
  // Identifies the page apart from its access ticket, so a renewed ticket does not reload it.
  srcKey: string;
  title: string;
  storageKey: string;
  sizing: CanvasFrameSizing;
  reloadToken?: number;
  className?: string;
  onRunRequest?: (request: CanvasRunRequest) => void;
  onFixRequest?: (errors: CanvasFrameError[]) => void;
  selectionEnabled?: boolean;
  onElementSelect?: (element: CanvasElementSelection | null) => void;
  documentFit?: boolean;
  relativePath?: string;
  onDocumentPath?: (path: string) => void;
  onDocumentKind?: (kind: import("@meowbert/shared/canvas-frame").CanvasDocumentKind) => void;
}

function useStableSource(src: string, srcKey: string, reloadToken: number): string {
  const [stableSrc, setStableSrc] = useState(src);
  const latestSrc = useRef(src);
  latestSrc.current = src;
  useEffect(() => {
    setStableSrc(latestSrc.current);
  }, [srcKey, reloadToken]);
  return stableSrc;
}

// A failed page still needs room for the notice that explains it.
const FAILED_MIN_HEIGHT = 220;

function resolveFrameHeight(sizing: CanvasFrameSizing, reportedHeight: number | null, failed: boolean): CSSProperties {
  if (sizing.mode === "fill") return { height: "100%" };
  const height = sizing.mode === "fixed"
    ? sizing.height
    : Math.max(sizing.minHeight, Math.min(sizing.maxHeight, reportedHeight ?? sizing.minHeight));
  return { height: failed ? Math.max(height, FAILED_MIN_HEIGHT) : height };
}

/** A sandboxed canvas page with load, error and blank-page states the user can act on. */
export function CanvasFrame(props: CanvasFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const theme = useCanvasTheme();
  const reloadToken = props.reloadToken ?? 0;
  const [retryCount, setRetryCount] = useState(0);
  const src = useStableSource(props.src, props.srcKey, reloadToken + retryCount);
  const loadKey = `${props.srcKey}#${reloadToken}#${retryCount}`;
  const bridge = useCanvasFrameBridge({
    frameRef, loadKey, viewKey: props.srcKey, storageKey: props.storageKey, theme, src,
    relativePath: props.relativePath, onDocumentPath: props.onDocumentPath,
    selectionEnabled: props.selectionEnabled, onElementSelect: props.onElementSelect,
    documentFit: props.documentFit, onDocumentKind: props.onDocumentKind
  });
  const { status, blank, errors, height, runRequest } = bridge.state;
  const failed = status === "unreachable" || (status === "ready" && blank && errors.length > 0);

  return (
    <div
      className={["canvas-frame", `canvas-frame-${props.sizing.mode}`, status === "loading" ? "is-loading" : "", props.className ?? ""].filter(Boolean).join(" ")}
      style={resolveFrameHeight(props.sizing, height, failed)}
      aria-busy={status === "loading"}
    >
      <iframe
        key={loadKey}
        ref={frameRef}
        className="canvas-frame-iframe"
        name={bridge.frameName}
        src={src}
        title={props.title}
        sandbox={CANVAS_FRAME_SANDBOX}
        onLoad={() => {
          bridge.handleFrameLoad();
          if (props.selectionEnabled) props.onElementSelect?.(null);
        }}
      />
      {failed ? (
        <CanvasFrameNotice
          unreachable={status === "unreachable"}
          errors={errors}
          onRetry={() => setRetryCount((count) => count + 1)}
          onFixRequest={props.onFixRequest}
        />
      ) : null}
      {!failed && status !== "loading" && (errors.length > 0 || blank) ? (
        <CanvasFrameIssues errors={errors} blank={blank} onFixRequest={props.onFixRequest} />
      ) : null}
      {runRequest ? (
        <CanvasRunRequestBar
          request={runRequest}
          canSend={Boolean(props.onRunRequest)}
          onSend={() => {
            props.onRunRequest?.(runRequest);
            bridge.dismissRunRequest();
          }}
          onDismiss={bridge.dismissRunRequest}
        />
      ) : null}
    </div>
  );
}
