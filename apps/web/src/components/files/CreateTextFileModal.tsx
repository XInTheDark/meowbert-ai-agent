import { useEffect, useState, type FormEvent } from "react";
import { FileText, X } from "lucide-react";

interface CreateTextFileModalProps {
  isOpen: boolean;
  title?: string;
  description?: string;
  submitLabel?: string;
  initialName?: string;
  initialContent?: string;
  onClose: () => void;
  onSubmit: (input: { name: string; content: string }) => Promise<void> | void;
}

export function CreateTextFileModal(props: CreateTextFileModalProps) {
  const [name, setName] = useState(props.initialName ?? "notes.txt");
  const [content, setContent] = useState(props.initialContent ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    setName(props.initialName ?? "notes.txt");
    setContent(props.initialContent ?? "");
    setError(null);
    setIsSubmitting(false);
  }, [props.initialContent, props.initialName, props.isOpen]);

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
  }, [isSubmitting, props]);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Choose a filename.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await props.onSubmit({ name: trimmedName, content });
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
      <div className="legal-modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: "40rem" }}>
        <div className="legal-modal-header">
          <h2 style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem" }}>
            <FileText size={18} />
            {props.title ?? "Create text file"}
          </h2>
          <button className="legal-close" onClick={props.onClose} aria-label="Close" disabled={isSubmitting}>
            <X size={18} />
          </button>
        </div>
        <form className="legal-modal-body" onSubmit={(event) => void handleSubmit(event)}>
          <p>{props.description ?? "Create a text file and add it immediately."}</p>
          <label style={{ display: "grid", gap: "0.4rem" }}>
            <strong>Filename</strong>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="notes.txt"
              spellCheck={false}
              autoFocus
              disabled={isSubmitting}
            />
          </label>
          <label style={{ display: "grid", gap: "0.4rem", marginTop: "1rem" }}>
            <strong>Content</strong>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={14}
              spellCheck={false}
              placeholder="Write anything you want the agent to have on hand."
              disabled={isSubmitting}
              style={{ fontFamily: "var(--font-mono, monospace)", resize: "vertical" }}
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="computer-use-modal-footer" style={{ marginTop: "1rem" }}>
            <button className="btn ghost" type="button" onClick={props.onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button className="btn primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : props.submitLabel ?? "Create file"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
