import { useEffect, useRef } from "react";
import type { TaskAttachment } from "../lib/types";

// Hands attachments from elsewhere in the project (such as the map) to the Master's composer.
// They wait here until that composer is mounted, so they survive navigating to the Master.
const EVENT_NAME = "meowbert:master-composer-attachments";
const pending = new Map<string, TaskAttachment[]>();

export function sendToMasterComposer(masterTaskId: string, attachments: TaskAttachment[]): void {
  pending.set(masterTaskId, [...(pending.get(masterTaskId) ?? []), ...attachments]);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: masterTaskId }));
}

function takePending(masterTaskId: string): TaskAttachment[] {
  const attachments = pending.get(masterTaskId) ?? [];
  pending.delete(masterTaskId);
  return attachments;
}

export function useMasterComposerAttachments(
  masterTaskId: string | null,
  appendAttachments: (attachments: TaskAttachment[]) => void
): void {
  const append = useRef(appendAttachments);
  append.current = appendAttachments;
  useEffect(() => {
    if (!masterTaskId) return;
    const deliver = () => {
      const attachments = takePending(masterTaskId);
      if (attachments.length) append.current(attachments);
    };
    deliver();
    const onEvent = (event: Event) => {
      if ((event as CustomEvent<string>).detail === masterTaskId) deliver();
    };
    window.addEventListener(EVENT_NAME, onEvent);
    return () => window.removeEventListener(EVENT_NAME, onEvent);
  }, [masterTaskId]);
}
