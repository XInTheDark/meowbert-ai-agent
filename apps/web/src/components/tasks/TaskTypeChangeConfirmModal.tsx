import { useEffect, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface TaskTypeChangeConfirmModalProps {
  targetTypeLabel: string;
  isApplying?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function TaskTypeChangeConfirmModal(props: TaskTypeChangeConfirmModalProps): JSX.Element {
  const headingId = "task-type-change-dialog-title";
  const { isApplying, onCancel, onConfirm } = props;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isApplying) {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isApplying, onCancel]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isApplying) return;
    void onConfirm();
  };

  return createPortal(
    <div className="legal-overlay" onClick={isApplying ? undefined : onCancel}>
      <form
        className="legal-modal task-type-change-dialog"
        style={{ maxWidth: "28rem" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="legal-modal-header">
          <h2 id={headingId}>Change task type?</h2>
          <button
            className="legal-close"
            type="button"
            onClick={onCancel}
            disabled={isApplying}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="legal-modal-body" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.95rem", lineHeight: 1.5 }}>
            Changing the task type to <strong>{props.targetTypeLabel}</strong> may cause some workflow progress to be lost.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
            <button type="button" className="btn ghost" onClick={onCancel} disabled={isApplying}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={isApplying}>
              {isApplying ? "Changing..." : "Change task type"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body
  );
}
