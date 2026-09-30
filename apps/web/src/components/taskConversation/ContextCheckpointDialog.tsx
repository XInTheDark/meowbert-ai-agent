import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function ContextCheckpointDialog(props: {
  checkpoint: string;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        props.onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  return createPortal(
    <div className="message-metadata-dialog-backdrop" onClick={props.onClose}>
      <div
        className="message-metadata-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="context-checkpoint-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="message-metadata-dialog-header">
          <h2 id="context-checkpoint-dialog-title">Context checkpoint</h2>
          <button className="action-btn" type="button" onClick={props.onClose} title="Close checkpoint">
            <X size={14} />
          </button>
        </div>
        <pre className="message-metadata-json">{props.checkpoint}</pre>
      </div>
    </div>,
    document.body
  );
}
