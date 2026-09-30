import { useEffect, useState, type FormEvent } from "react";
import { NotebookPen, X } from "lucide-react";

interface ProjectContextNoteModalProps {
  isOpen: boolean;
  targetLabel: string;
  initialValue?: string | null;
  onClose: () => void;
  onSubmit: (note: string | null) => Promise<void> | void;
}

export function ProjectContextNoteModal(props: ProjectContextNoteModalProps) {
  const [value, setValue] = useState(props.initialValue ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    setValue(props.initialValue ?? "");
    setIsSubmitting(false);
    setError(null);
  }, [props.initialValue, props.isOpen]);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, props.isOpen, props.onClose]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const normalized = value.trim();
      await props.onSubmit(normalized.length > 0 ? normalized : null);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!props.isOpen) {
    return null;
  }

  return (
    <div className="legal-overlay" onClick={() => !isSubmitting && props.onClose()}>
      <div className="legal-modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: "38rem" }}>
        <div className="legal-modal-header">
          <h2 style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem" }}>
            <NotebookPen size={18} />
            Add note
          </h2>
          <button className="legal-close" onClick={props.onClose} aria-label="Close" disabled={isSubmitting}>
            <X size={18} />
          </button>
        </div>
        <form className="legal-modal-body" onSubmit={(event) => void handleSubmit(event)}>
          <p>Add a short note for <strong>{props.targetLabel}</strong>. This note will be injected into future task system prompts.</p>
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            rows={10}
            autoFocus
            placeholder="Explain why this file matters, what it contains, or when to use it."
            disabled={isSubmitting}
            style={{ resize: "vertical" }}
          />
          {error ? <p className="error-text">{error}</p> : null}
          <div className="computer-use-modal-footer" style={{ marginTop: "1rem" }}>
            <button className="btn ghost" type="button" onClick={props.onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button className="btn ghost" type="button" onClick={() => setValue("")} disabled={isSubmitting}>
              Clear note
            </button>
            <button className="btn primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save note"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
