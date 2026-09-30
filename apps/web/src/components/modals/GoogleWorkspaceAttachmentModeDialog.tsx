import { useEffect } from "react";
import { createPortal } from "react-dom";
import { FileOutput, PencilLine, X } from "lucide-react";

export type GoogleWorkspaceAttachmentMode = "office" | "direct";

interface GoogleWorkspaceAttachmentModeDialogProps {
  fileCount: number;
  fileMode: "copy" | "live_sync";
  canAttachDirectly: boolean;
  onChoose: (mode: GoogleWorkspaceAttachmentMode) => void;
  onCancel: () => void;
}

export function GoogleWorkspaceAttachmentModeDialog(
  props: GoogleWorkspaceAttachmentModeDialogProps
): JSX.Element {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [props.onCancel]);

  const noun = props.fileCount === 1 ? "Google file" : `${props.fileCount} Google files`;
  return createPortal(
    <div className="google-workspace-mode-backdrop" onClick={props.onCancel}>
      <div
        className="google-workspace-mode-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="google-workspace-mode-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="google-workspace-mode-header">
          <div>
            <h2 id="google-workspace-mode-title">How should {noun} be attached?</h2>
            <p>The Office option is recommended and selected by default.</p>
          </div>
          <button className="action-btn" type="button" onClick={props.onCancel} aria-label="Cancel attachment">
            <X size={15} />
          </button>
        </div>

        <div className="google-workspace-mode-options">
          <button
            type="button"
            className="google-workspace-mode-option primary-option"
            autoFocus
            onClick={() => props.onChoose("office")}
          >
            <FileOutput size={20} />
            <span>
              <strong>Convert to Office files</strong>
              <small>
                {props.fileMode === "live_sync"
                  ? "Creates DOCX, XLSX, or PPTX working copies. Some native features may not round-trip."
                  : "Creates DOCX, XLSX, or PPTX copies."}
              </small>
            </span>
          </button>

          <button
            type="button"
            className="google-workspace-mode-option"
            disabled={!props.canAttachDirectly}
            onClick={() => props.onChoose("direct")}
          >
            <PencilLine size={20} />
            <span>
              <strong>
                Attach Google files directly
                <span className="google-workspace-experimental-label">Experimental</span>
              </strong>
              <small>
                {props.canAttachDirectly
                  ? "The agent can read and edit the original shared files immediately."
                  : "Reconnect Google Drive with write access to enable direct editing."}
              </small>
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
