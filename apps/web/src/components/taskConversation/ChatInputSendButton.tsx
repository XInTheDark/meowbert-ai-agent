import { ArrowUp, Loader2 } from "lucide-react";

export interface ChatInputSendButtonProps {
  isSubmitting: boolean;
  submitBlockedByUploads: boolean;
  isQueuedSubmitPending: boolean;
  isSendButtonDisabled: boolean;
  onClick: () => void;
}

export function ChatInputSendButton(props: ChatInputSendButtonProps) {
  const ariaLabel = props.isSubmitting
    ? "Sending message..."
    : props.isQueuedSubmitPending
      ? "Message will send when uploads finish"
      : props.submitBlockedByUploads
        ? "Uploads are still running. Click to send when they finish."
        : "Send message";

  const title = props.isSubmitting
    ? "Sending message..."
    : props.isQueuedSubmitPending
      ? "Message will send when uploads finish."
      : props.submitBlockedByUploads
        ? "Uploads are still running. Click to send when they finish."
        : undefined;

  return (
    <button
      className={[
        "send-btn",
        props.submitBlockedByUploads ? "send-btn-pending-uploads" : "",
        props.isQueuedSubmitPending ? "send-btn-queued" : "",
        props.isSubmitting ? "send-btn-submitting" : ""
      ].filter(Boolean).join(" ")}
      onClick={props.onClick}
      disabled={props.isSendButtonDisabled}
      aria-disabled={props.submitBlockedByUploads ? true : undefined}
      aria-label={ariaLabel}
      title={title}
    >
      {props.isQueuedSubmitPending ? (
        <span className="send-btn-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      ) : props.isSubmitting ? (
        <Loader2 size={16} className="spin" aria-hidden="true" />
      ) : (
        <ArrowUp size={18} />
      )}
    </button>
  );
}
