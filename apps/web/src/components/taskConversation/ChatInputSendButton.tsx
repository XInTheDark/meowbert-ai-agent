import { ArrowUp, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ScheduleSendDialog } from "./ScheduleSendDialog";

export interface ChatInputSendButtonProps {
  isSubmitting: boolean;
  submitBlockedByUploads: boolean;
  isQueuedSubmitPending: boolean;
  isSendButtonDisabled: boolean;
  onClick: () => void;
  onScheduleSend?: (sendAt: string) => void;
}

export function ChatInputSendButton(props: ChatInputSendButtonProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    const keyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", keyDown);
    };
  }, [menu]);
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
    <>
    <button
      className={[
        "send-btn",
        props.submitBlockedByUploads ? "send-btn-pending-uploads" : "",
        props.isQueuedSubmitPending ? "send-btn-queued" : "",
        props.isSubmitting ? "send-btn-submitting" : ""
      ].filter(Boolean).join(" ")}
      onClick={props.onClick}
      onContextMenu={props.onScheduleSend ? (event) => {
        event.preventDefault();
        if (props.isSendButtonDisabled || props.submitBlockedByUploads) return;
        setMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 180)), y: Math.max(8, event.clientY - 44) });
      } : undefined}
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
    {menu ? createPortal(
      <div ref={menuRef} className="send-context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
        <button type="button" className="btn ghost full" role="menuitem" autoFocus onClick={() => { setMenu(null); setScheduling(true); }}>Schedule send</button>
      </div>, document.body
    ) : null}
    {scheduling && props.onScheduleSend ? <ScheduleSendDialog onClose={() => setScheduling(false)} onSchedule={props.onScheduleSend} /> : null}
    </>
  );
}
