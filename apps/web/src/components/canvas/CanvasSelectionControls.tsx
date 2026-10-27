import { useState } from "react";
import { ArrowUp, MousePointer2, X } from "lucide-react";
import type { CanvasElementSelection } from "@meowbert/shared/canvas-frame";

export function CanvasSelectButton(props: { active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={`icon-btn${props.active ? " active" : ""}`} onClick={props.onClick}
      title="Select an element" aria-label="Select an element" aria-pressed={props.active} disabled={props.disabled}>
      <MousePointer2 size={14} aria-hidden="true" />
    </button>
  );
}

export function CanvasSelectionPrompt(props: {
  element: CanvasElementSelection | null;
  onSend: (instruction: string) => void;
  onDismiss: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  return (
    <form className="canvas-selection-prompt" onKeyDown={(event) => {
      if (event.key === "Escape") props.onDismiss();
    }} onSubmit={(event) => {
      event.preventDefault();
      if (props.element && instruction.trim()) props.onSend(instruction);
    }}>
      {props.element ? (
        <>
          <span className="canvas-selection-target" title={props.element.selector}>
            {props.element.attributes["aria-label"] || props.element.text.slice(0, 60) || props.element.tagName}
          </span>
          <input autoFocus value={instruction} onChange={(event) => setInstruction(event.target.value)}
            placeholder="Ask about this element" aria-label="Ask about selected element" />
          <button type="submit" className="btn primary icon-btn" disabled={!instruction.trim()} aria-label="Send selection request">
            <ArrowUp size={15} aria-hidden="true" />
          </button>
        </>
      ) : <span className="muted-text">Click an element. Esc to cancel.</span>}
      <button type="button" className="icon-btn" onClick={props.onDismiss} aria-label="Clear selection">
        <X size={15} aria-hidden="true" />
      </button>
    </form>
  );
}
