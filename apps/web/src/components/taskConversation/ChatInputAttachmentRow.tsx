import { LoaderCircle, Pin, X } from "lucide-react";
import { useCallback, useState } from "react";
import type { TaskAttachment } from "../../lib/types";
import { isGoogleWorkspaceReferenceFileName } from "../../sources/googleWorkspaceAttachments";
import { AttachmentCiteMenu } from "./composer/AttachmentCiteMenu";
import { isCitableAttachment } from "./composer/useComposerCitations";

interface ChatInputAttachmentRowProps {
  pendingUploads: Array<{ id: string; label: string }>;
  attachments: TaskAttachment[];
  onRemoveAttachment: (id: string) => void;
  onCiteAttachment?: (attachment: TaskAttachment) => void;
  onToggleAttachmentForceInclude?: (id: string) => void;
  onResetInput: () => void;
  isSubmitting: boolean;
}

export function ChatInputAttachmentRow({
  pendingUploads,
  attachments,
  onRemoveAttachment,
  onCiteAttachment,
  onToggleAttachmentForceInclude,
  onResetInput,
  isSubmitting
}: ChatInputAttachmentRowProps) {
  const [citeMenu, setCiteMenu] = useState<{ x: number; y: number; attachment: TaskAttachment } | null>(null);
  const closeCiteMenu = useCallback(() => setCiteMenu(null), []);

  return (
    <>
      {pendingUploads.length > 0 && (
        <div className={`chip-row attachment-chip-row${attachments.length > 0 ? " attachment-chip-row-compact" : ""}`}>
          {pendingUploads.map((upload) => (
            <div key={upload.id} className="chip attachment-chip chip-uploading">
              <LoaderCircle size={13} className="spin-icon" />
              <span className="attachment-chip-label" title={upload.label}>Uploading {upload.label}</span>
            </div>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="attachment-list">
          <div className="chip-row attachment-chip-row">
            {attachments.map((att) => {
              const canCite = onCiteAttachment !== undefined && isCitableAttachment(att);
              return (
              <div
                key={att.id}
                className={`chip attachment-chip${att.forceInclude === true ? " chip-force-include" : ""}`}
                onContextMenu={canCite ? (event) => {
                  event.preventDefault();
                  setCiteMenu({ x: event.clientX, y: event.clientY, attachment: att });
                } : undefined}
              >
                <span className="attachment-chip-label" title={att.label}>{att.label}</span>
                {onToggleAttachmentForceInclude && !isGoogleWorkspaceReferenceFileName(att.label) ? (
                  <button
                    type="button"
                    className={`attachment-force-include-btn${att.forceInclude === true ? " active" : ""}`}
                    aria-pressed={att.forceInclude === true}
                    aria-label={att.forceInclude === true ? `Stop force including ${att.label}` : `Force include ${att.label}`}
                    title={att.forceInclude === true ? "Force include is on" : "Force include: send the full file to the model"}
                    onClick={() => onToggleAttachmentForceInclude(att.id)}
                  >
                    <Pin size={12} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="attachment-chip-remove-btn"
                  aria-label={`Remove ${att.label}`}
                  title="Remove attachment"
                  onClick={() => onRemoveAttachment(att.id)}
                >
                  <X size={14} />
                </button>
              </div>
              );
            })}
          </div>
          <button
            type="button"
            className="attachment-reset-input-btn"
            onClick={onResetInput}
            disabled={isSubmitting}
          >
            Reset input
          </button>
        </div>
      )}

      {citeMenu && onCiteAttachment ? (
        <AttachmentCiteMenu
          x={citeMenu.x}
          y={citeMenu.y}
          onCite={() => onCiteAttachment(citeMenu.attachment)}
          onClose={closeCiteMenu}
        />
      ) : null}
    </>
  );
}
