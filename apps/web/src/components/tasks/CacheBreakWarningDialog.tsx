import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { CacheBreakingChange } from "../../task/cacheBreakingChanges";

const CHANGE_LABELS: Record<CacheBreakingChange, string> = {
  agent: "A different model",
  computer_use: "Computer use turned on"
};

interface CacheBreakWarningDialogProps {
  changes: CacheBreakingChange[];
  onKeepPrevious: () => void;
  onSendAnyway: () => void;
  onCancel: () => void;
}

export function CacheBreakWarningDialog(props: CacheBreakWarningDialogProps): JSX.Element {
  const headingId = "cache-break-warning-title";
  const { onCancel } = props;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return createPortal(
    <div className="legal-overlay" onClick={props.onCancel}>
      <div
        className="legal-modal cache-break-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="legal-modal-header">
          <h2 id={headingId}>Re-read the whole conversation?</h2>
          <button className="action-btn" type="button" onClick={props.onCancel} title="Close">
            <X size={14} />
          </button>
        </div>
        <div className="legal-modal-body cache-break-dialog-body">
          <p>This message changes what the task runs with, so its cached context can't be reused:</p>
          <ul>
            {props.changes.map((change) => <li key={change}>{CHANGE_LABELS[change]}</li>)}
          </ul>
        </div>
        <div className="computer-use-modal-footer">
          <button className="btn ghost" type="button" onClick={props.onSendAnyway}>
            Send anyway
          </button>
          <button className="btn primary" type="button" onClick={props.onKeepPrevious} autoFocus>
            Keep previous settings
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
