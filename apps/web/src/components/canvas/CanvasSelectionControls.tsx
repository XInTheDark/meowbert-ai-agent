import { useState } from "react";
import { ArrowUp, MousePointer2, MousePointerClick, X } from "lucide-react";
import type { CanvasElementSelection } from "@meowbert/shared/canvas-frame";
import type { CanvasSelectionIntent } from "./useCanvasSelection";

export function CanvasSelectButton(props: { active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={`icon-btn${props.active ? " active" : ""}`} onClick={props.onClick}
      title="Select an element" aria-label="Select an element" aria-pressed={props.active} disabled={props.disabled}>
      <MousePointer2 size={14} aria-hidden="true" />
    </button>
  );
}

export function describeCanvasElement(element: CanvasElementSelection): string {
  return element.attributes["aria-label"] || element.text.slice(0, 60) || `<${element.tagName}>`;
}

/** Composer under the canvas for the picked element: asks Meowbert or saves a comment, depending on intent. */
export function CanvasSelectionPrompt(props: {
  intent: CanvasSelectionIntent;
  element: CanvasElementSelection | null;
  onSubmit: (body: string) => void;
  onDismiss: () => void;
  pending?: boolean;
}) {
  const [body, setBody] = useState("");
  const comment = props.intent === "comment";
  const ready = Boolean(props.element && body.trim() && !props.pending);
  return (
    <form className={`canvas-selection-prompt${props.element ? "" : " is-picking"}`} onKeyDown={(event) => {
      if (event.key === "Escape") props.onDismiss();
    }} onSubmit={(event) => {
      event.preventDefault();
      if (ready) props.onSubmit(body);
    }}>
      <div className="canvas-selection-head">
        {props.element ? (
          <span className="canvas-selection-target" title={props.element.selector}>
            <MousePointerClick size={13} aria-hidden="true" />
            <span>{describeCanvasElement(props.element)}</span>
          </span>
        ) : (
          <span className="canvas-selection-hint">
            {comment ? "Click an element to comment on" : "Click an element to ask about"}
            <kbd>Esc</kbd>
          </span>
        )}
        <button type="button" className="icon-btn" onClick={props.onDismiss} title="Cancel" aria-label="Clear selection">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {props.element ? (
        <div className="canvas-selection-input">
          <input autoFocus value={body} onChange={(event) => setBody(event.target.value)}
            placeholder={comment ? "Add a comment" : "Ask Meowbert about this"}
            aria-label={comment ? "Comment on selected element" : "Ask about selected element"} />
          {comment ? (
            <button type="submit" className="btn primary" disabled={!ready} aria-label="Save comment">Save</button>
          ) : (
            <button type="submit" className="btn primary icon-btn" disabled={!ready} aria-label="Send selection request">
              <ArrowUp size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : null}
    </form>
  );
}
