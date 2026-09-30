import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link2, X } from "lucide-react";
import type { ApiClient } from "../../lib/api";
import type { TaskAttachment } from "../../lib/types";
import { toTaskAttachmentFromSourceAttachment } from "../../sources/sourceAttachments";
import type { WorkspaceSourceAttachResponse, WorkspaceSourceSummary } from "../../sources/sourceTypes";

interface SourceNoteAttachmentModalProps {
  api: ApiClient;
  workspaceId: string | null;
  source: WorkspaceSourceSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (attachments: TaskAttachment[]) => void;
  targetLabel?: string;
}

export function SourceNoteAttachmentModal(props: SourceNoteAttachmentModalProps) {
  const targetLabel = props.targetLabel ?? "task";
  const [url, setUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    setUrl("");
    setError(null);
  }, [props.isOpen, props.source?.id]);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.isOpen, props.onClose]);

  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!props.workspaceId || !props.source || !url.trim()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await props.api.post<WorkspaceSourceAttachResponse>(
        `/api/workspaces/${props.workspaceId}/sources/${props.source.id}/attach`,
        { url: url.trim() }
      );
      props.onSelect([toTaskAttachmentFromSourceAttachment(response.attachment)]);
      props.onClose();
    } catch (attachError) {
      setError(attachError instanceof Error ? attachError.message : String(attachError));
    } finally {
      setIsSubmitting(false);
    }
  }, [props, url]);

  if (!props.isOpen || !props.source) {
    return null;
  }

  return (
    <div className="environment-file-picker-overlay" onClick={props.onClose}>
      <div
        className="environment-file-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-note-attachment-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="environment-file-picker-header">
          <div>
            <h2 id="source-note-attachment-title">{props.source.name}</h2>
            <p className="environment-file-picker-subtitle">
              {`Paste a video link to attach its metadata to this ${targetLabel}.`}
            </p>
          </div>
          <button type="button" className="legal-close" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form className="environment-file-picker-body" onSubmit={handleSubmit}>
          <article className="section-card files-layout-card environment-file-picker-card">
            <div className="stack-form" style={{ gap: "0.9rem" }}>
              <div className="muted-text" style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                <Link2 size={15} />
                Metadata only — the video itself is not downloaded.
              </div>

              <label>
                <strong>Video URL</strong>
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              {error ? <p className="error-text" style={{ margin: 0 }}>{error}</p> : null}
            </div>
          </article>

          <div className="environment-file-picker-footer">
            <p className="muted-text environment-file-picker-status">
              {`Add the link once, and this ${targetLabel} will receive a compact metadata summary as attached context.`}
            </p>
            <div className="row-actions">
              <button type="button" className="btn ghost" onClick={props.onClose}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!url.trim() || isSubmitting}>
                {isSubmitting ? "Attaching..." : "Attach video"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
