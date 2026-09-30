import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface MessageMetadataDialogProps {
  metadata: Record<string, unknown> | null | undefined;
  onClose: () => void;
}

function formatMetadata(metadata: Record<string, unknown> | null | undefined): string {
  return JSON.stringify(metadata ?? {}, null, 2);
}

export function MessageMetadataDialog({ metadata, onClose }: MessageMetadataDialogProps): JSX.Element {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="message-metadata-dialog-backdrop" onClick={onClose}>
      <div
        className="message-metadata-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-metadata-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="message-metadata-dialog-header">
          <h2 id="message-metadata-dialog-title">Metadata</h2>
          <button className="action-btn" type="button" onClick={onClose} title="Close metadata">
            <X size={14} />
          </button>
        </div>
        <pre className="message-metadata-json">{formatMetadata(metadata)}</pre>
      </div>
    </div>,
    document.body
  );
}
