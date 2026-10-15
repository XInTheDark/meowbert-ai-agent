import { useCallback, useEffect, useMemo, useState } from "react";
import type { TaskMessage } from "../../../lib/types";

// A pending bubble that never sees its message (for example while an older page is open) gives way after this.
const PENDING_FOLLOW_UP_MAX_MS = 20_000;

interface PendingFollowUpState {
  text: string;
  messageId: string | null;
}

export interface PendingFollowUpControls {
  text: string | null;
  begin: (text: string) => void;
  confirm: (messageId: string | null) => void;
  clear: () => void;
}

// Shows a sent message right away and hides it once the conversation has loaded the stored copy.
export function usePendingFollowUp(taskId: string, messages: TaskMessage[]): PendingFollowUpControls {
  const [pending, setPending] = useState<PendingFollowUpState | null>(null);

  const begin = useCallback((text: string) => setPending({ text, messageId: null }), []);
  const clear = useCallback(() => setPending(null), []);
  const confirm = useCallback((messageId: string | null) => {
    setPending((current) => (current && messageId ? { ...current, messageId } : null));
  }, []);

  useEffect(() => {
    setPending(null);
  }, [taskId]);

  useEffect(() => {
    if (pending?.messageId && messages.some((message) => message.id === pending.messageId)) {
      setPending(null);
    }
  }, [messages, pending?.messageId]);

  useEffect(() => {
    if (!pending) {
      return;
    }

    const timer = window.setTimeout(() => setPending(null), PENDING_FOLLOW_UP_MAX_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  return useMemo(() => ({
    text: pending?.text ?? null,
    begin,
    confirm,
    clear
  }), [begin, clear, confirm, pending?.text]);
}
