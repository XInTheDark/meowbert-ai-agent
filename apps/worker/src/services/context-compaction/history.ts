import { asText } from "../agent/utils.js";
import {
  COMPACTION_MARKER_KIND,
  MAX_SERIALIZED_ITEM_CHARS,
  truncate,
  type TaskMessageRow
} from "./shared.js";

function isCompactionMessagePayload(payload: Record<string, unknown>): boolean {
  return payload.kind === COMPACTION_MARKER_KIND || payload.kind === "context_checkpoint" || payload.kind === "context_recovery";
}

export function getMessagesAfterLatestCompaction(messages: TaskMessageRow[]): TaskMessageRow[] {
  let lastCompactionIndex = -1;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "system") {
      continue;
    }

    if (!isCompactionMessagePayload(message.content_json)) {
      continue;
    }

    lastCompactionIndex = index;
  }

  if (lastCompactionIndex < 0) {
    return messages;
  }

  return messages.slice(lastCompactionIndex);
}

export function isCompactionSystemMessage(message: TaskMessageRow): boolean {
  if (message.role !== "system") {
    return false;
  }

  return isCompactionMessagePayload(message.content_json);
}

export function getVisibleMessagesForContextClear(messages: TaskMessageRow[]): TaskMessageRow[] {
  return messages.filter((message) => !isCompactionSystemMessage(message));
}

export function getMessagesForV2ActiveWindow(messages: TaskMessageRow[]): TaskMessageRow[] {
  return getMessagesAfterLatestCompaction(messages).filter((message) => !isCompactionSystemMessage(message));
}

export function serializeTaskMessagesForDebug(messages: TaskMessageRow[]): string {
  if (messages.length === 0) {
    return "(no task messages)";
  }

  return messages
    .map((message, index) => {
      const role = message.role;
      const text = truncate(asText(message.content_json), MAX_SERIALIZED_ITEM_CHARS);
      return `${index + 1}. [role=${role}]\n${text}`;
    })
    .join("\n\n");
}
