import { loadConversationSnapshots, remapConversationOutline } from "@meowbert/shared";
import type { PoolClient } from "pg";

export interface ThreadSourceMessage {
  id: string;
  role: string;
  content_json: Record<string, unknown>;
  parent_message_id: string | null;
}

export const THREAD_CONTEXT_MESSAGE_KIND = "thread_context";

function hasVisibleText(content: Record<string, unknown>): boolean {
  return typeof content.text === "string" && content.text.trim().length > 0;
}

/**
 * Keep only the user and assistant messages of a lineage, as plain text. Tool calls, tool results
 * and reasoning are dropped (`response_items` on assistant messages is what the worker would replay
 * them from), and each kept message is re-parented onto the previous kept one.
 */
export function selectConversationOnlyMessages<T extends ThreadSourceMessage>(messages: T[], anchorMessageId: string): T[] {
  const kept: T[] = [];
  for (const message of messages) {
    const isAnchor = message.id === anchorMessageId;
    if (message.role === "user" || (message.role === "assistant" && (isAnchor || hasVisibleText(message.content_json)))) {
      const { response_items: _responseItems, ...content } = message.content_json;
      kept.push({ ...message, content_json: content, parent_message_id: kept[kept.length - 1]?.id ?? null });
    }
  }
  return kept;
}

export async function loadParentOutline(
  client: PoolClient,
  parentTaskId: string,
  anchorMessageId: string,
  ids: Map<string, string>
): Promise<string | null> {
  const snapshots = await loadConversationSnapshots(client, parentTaskId, anchorMessageId);
  const markdown = snapshots.find((snapshot) => snapshot.kind === "outline")?.payload_json.markdown;
  return typeof markdown === "string" && markdown.trim() ? remapConversationOutline(markdown, ids) : null;
}

export function buildThreadContextMessageContent(outline: string | null): Record<string, unknown> {
  const note = "This thread branches off a longer task. Only its user and assistant messages are included here; tool calls and their results were left out, though files the task produced are still in its directory.";
  return {
    kind: THREAD_CONTEXT_MESSAGE_KIND,
    text: outline ? `${note}\n\nTask outline:\n\n${outline}` : note
  };
}
