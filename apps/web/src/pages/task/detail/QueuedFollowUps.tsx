import { useState } from "react";
import { Clock, Pencil, X } from "lucide-react";
import type { ApiClient } from "../../../lib/api";
import type { TaskQueuedMessage } from "../../../lib/types";
import { removeQueuedTaskMessage, sendQueuedTaskMessageNow } from "./taskDetailMutations";

interface QueuedFollowUpsProps {
  api: ApiClient;
  taskId: string;
  messages: TaskQueuedMessage[];
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onEdit: (text: string) => void;
}

// Follow-ups waiting for the running task's next turn. Send now interrupts the run instead;
// Edit takes the message out of the queue and hands its text back to the composer.
export function QueuedFollowUps(props: QueuedFollowUpsProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (props.messages.length === 0) return null;

  async function run(id: string, action: () => Promise<unknown>): Promise<void> {
    setBusyId(id);
    try {
      await action();
      await props.onChanged();
    } catch (error) {
      props.onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function takeForEdit(message: TaskQueuedMessage): Promise<void> {
    const removed = await removeQueuedTaskMessage(props.api, props.taskId, message.id);
    if (!removed) throw new Error("This message was already delivered.");
    props.onEdit(message.text);
  }

  return (
    <ul className="queued-follow-ups" aria-label="Queued messages">
      {props.messages.map((message) => (
        <li key={message.id} className="queued-follow-up">
          <Clock size={13} aria-hidden="true" className="queued-follow-up-icon" />
          <span className="queued-follow-up-text" title={message.text}>{message.text}</span>
          <button
            type="button"
            className="btn ghost queued-follow-up-send"
            disabled={busyId !== null}
            onClick={() => void run(message.id, () => sendQueuedTaskMessageNow(props.api, props.taskId, message.id))}
          >
            Send now
          </button>
          <button
            type="button"
            className="btn ghost queued-follow-up-edit"
            aria-label="Edit queued message"
            title="Edit"
            disabled={busyId !== null}
            onClick={() => void run(message.id, () => takeForEdit(message))}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="btn ghost queued-follow-up-remove"
            aria-label="Remove queued message"
            title="Remove"
            disabled={busyId !== null}
            onClick={() => void run(message.id, () => removeQueuedTaskMessage(props.api, props.taskId, message.id))}
          >
            <X size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}
