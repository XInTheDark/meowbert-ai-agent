import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";

export interface TaskForkOptions {
  title?: string;
  copyTaskFiles: boolean;
}

interface TaskForkDialogProps {
  title?: string;
  initialTitle?: string;
  showTitleField?: boolean;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (options: TaskForkOptions) => void;
}

export function TaskForkDialog(props: TaskForkDialogProps): JSX.Element {
  const [titleDraft, setTitleDraft] = useState(props.initialTitle ?? "");
  const [copyTaskFiles, setCopyTaskFiles] = useState(true);
  const headingId = "task-fork-dialog-title";
  const { isSubmitting, onCancel } = props;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, onCancel]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (props.isSubmitting) {
      return;
    }

    props.onConfirm({
      title: props.showTitleField ? titleDraft.trim() : undefined,
      copyTaskFiles
    });
  };

  return createPortal(
    <div className="legal-overlay" onClick={props.isSubmitting ? undefined : props.onCancel}>
      <form
        className="legal-modal task-fork-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="legal-modal-header">
          <h2 id={headingId}>{props.title ?? "Fork task"}</h2>
          <button
            className="action-btn"
            type="button"
            onClick={props.onCancel}
            title="Close"
            disabled={props.isSubmitting}
          >
            <X size={14} />
          </button>
        </div>

        <div className="legal-modal-body task-fork-dialog-body">
          {props.showTitleField ? (
            <label className="task-fork-field">
              <span>Title</span>
              <input
                type="text"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                maxLength={240}
                disabled={props.isSubmitting}
                autoFocus
              />
            </label>
          ) : null}

          <label className="task-fork-copy-option">
            <input
              type="checkbox"
              checked={copyTaskFiles}
              onChange={(event) => setCopyTaskFiles(event.target.checked)}
              disabled={props.isSubmitting}
            />
            <span>
              <strong>Include task files</strong>
              <small>Copies the task workspace. Large folders can take a while.</small>
            </span>
          </label>
        </div>

        <div className="computer-use-modal-footer task-fork-dialog-footer">
          <button className="btn ghost" type="button" onClick={props.onCancel} disabled={props.isSubmitting}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={props.isSubmitting}>
            {props.isSubmitting ? (
              <>
                <Loader2 className="task-fork-spin" size={16} />
                Forking task...
              </>
            ) : "Fork task"}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}
