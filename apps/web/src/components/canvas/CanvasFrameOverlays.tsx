import { useEffect, useState } from "react";
import { AlertTriangle, RotateCw, Sparkles, Wrench, X } from "lucide-react";
import type { CanvasFrameError } from "@meowbert/shared/canvas-frame";
import type { CanvasRunRequest } from "./useCanvasFrameBridge";

// Pages that render after load report it within a few seconds; only then is "blank" worth showing.
const BLANK_NOTICE_DELAY_MS = 3000;

function describeError(error: CanvasFrameError): string {
  const location = error.source ? ` (${error.source.split("/").pop()}${error.line ? `:${error.line}` : ""})` : "";
  return `${error.message}${location}`;
}

function CanvasErrorList(props: { errors: CanvasFrameError[] }) {
  return (
    <ul className="canvas-frame-error-list">
      {props.errors.map((error, index) => (
        <li key={`${error.kind}:${index}`} title={error.source ?? undefined}>{describeError(error)}</li>
      ))}
    </ul>
  );
}

export function CanvasFrameNotice(props: {
  unreachable: boolean;
  errors: CanvasFrameError[];
  onRetry: () => void;
  onFixRequest?: (errors: CanvasFrameError[]) => void;
}) {
  return (
    <div className="canvas-frame-notice" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <strong>{props.unreachable ? "This page couldn't be loaded" : "This page hit an error and rendered nothing"}</strong>
      {props.errors.length > 0 ? <CanvasErrorList errors={props.errors.slice(0, 4)} /> : null}
      <div className="canvas-frame-notice-actions">
        <button type="button" className="btn ghost" onClick={props.onRetry}>
          <RotateCw size={14} aria-hidden="true" /> Retry
        </button>
        {props.onFixRequest && props.errors.length > 0 ? (
          <button type="button" className="btn primary" onClick={() => props.onFixRequest?.(props.errors)}>
            <Wrench size={14} aria-hidden="true" /> Fix
          </button>
        ) : null}
      </div>
    </div>
  );
}

function useDelayedFlag(value: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    if (!value) {
      setDelayed(false);
      return;
    }
    const timer = window.setTimeout(() => setDelayed(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return delayed;
}

export function CanvasFrameIssues(props: {
  errors: CanvasFrameError[];
  blank: boolean;
  onFixRequest?: (errors: CanvasFrameError[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const showBlank = useDelayedFlag(props.blank && props.errors.length === 0, BLANK_NOTICE_DELAY_MS);
  if (props.errors.length === 0 && !showBlank) return null;
  const label = props.errors.length > 0
    ? `${props.errors.length} ${props.errors.length === 1 ? "error" : "errors"}`
    : "Nothing rendered";

  return (
    <div className={`canvas-frame-issues${expanded ? " expanded" : ""}`} role="status">
      <div className="canvas-frame-issues-bar">
        <button type="button" className="canvas-frame-issues-toggle" onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded} disabled={props.errors.length === 0}>
          <AlertTriangle size={13} aria-hidden="true" /> {label}
        </button>
        {props.onFixRequest && props.errors.length > 0 ? (
          <button type="button" className="canvas-frame-issues-fix" onClick={() => props.onFixRequest?.(props.errors)}>
            <Wrench size={13} aria-hidden="true" /> Fix
          </button>
        ) : null}
      </div>
      {expanded ? <CanvasErrorList errors={props.errors} /> : null}
    </div>
  );
}

export function CanvasRunRequestBar(props: {
  request: CanvasRunRequest;
  canSend: boolean;
  onSend: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="canvas-run-request" role="dialog" aria-label="Request from this page">
      <Sparkles size={15} aria-hidden="true" />
      <p>
        <span className="muted-text">This page wants to send:</span> {props.request.prompt}
      </p>
      {props.canSend ? (
        <button type="button" className="btn primary" onClick={props.onSend}>Send</button>
      ) : null}
      <button type="button" className="icon-btn" onClick={props.onDismiss} aria-label="Dismiss request">
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
