import type { ResponseInputItem } from "openai/resources/responses/responses";
import { getHistoryItemContent } from "./history-item.js";

// Two items always fit, so the latest user message and its reply are never crowded out.
const MAX_SEED_ITEM_CHARS = 12_000;
const MAX_SEED_TOTAL_CHARS = 24_000;
const OPAQUE_ITEM_MARKER = /\n\[id: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]$/i;
const TRUNCATION_NOTICE = "\n[excerpt truncated; the full item is in the context history]";
const INTERNAL_USER_NOTICE_PREFIXES = [
  "[System:",
  "Shell tool result:",
  "The timed task's deadline has been reached.",
  // Force-included files belong to the window they were sent in; the path stays in the user's message.
  "Force-included file (",
  "Force-included note attachment (",
  "[Attachment force include skipped:",
  "[Attachment marked force include:"
];

function isUserMessage(item: ResponseInputItem): boolean {
  const record = item as { role?: unknown; content?: unknown };
  return record.role === "user"
    && typeof record.content === "string"
    && !INTERNAL_USER_NOTICE_PREFIXES.some((prefix) => (record.content as string).startsWith(prefix));
}

function readFinalResponse(argumentsJson: string): string | null {
  try {
    const { response } = JSON.parse(argumentsJson) as { response?: unknown };
    return typeof response === "string" ? response : null;
  } catch {
    return null;
  }
}

// Agents usually answer through final_response, whose call cannot be replayed without its output.
function readReplyText(item: ResponseInputItem): string | null {
  const record = item as { role?: unknown; type?: unknown; name?: unknown; arguments?: unknown };
  if (record.role === "assistant") return getHistoryItemContent(item) || null;
  return record.type === "function_call" && record.name === "final_response" && typeof record.arguments === "string"
    ? readFinalResponse(record.arguments)
    : null;
}

function boundContent(content: string): string {
  if (content.length <= MAX_SEED_ITEM_CHARS) return content;
  const marker = content.match(OPAQUE_ITEM_MARKER)?.[0] ?? "";
  return `${content.slice(0, MAX_SEED_ITEM_CHARS - marker.length - TRUNCATION_NOTICE.length)}${TRUNCATION_NOTICE}${marker}`;
}

function toSeedItem(item: ResponseInputItem, includeReplies: boolean, replyTaken: boolean): ResponseInputItem | null {
  if (isUserMessage(item)) return { role: "user", content: boundContent((item as { content: string }).content) };
  const reply = includeReplies && !replyTaken ? readReplyText(item) : null;
  return reply ? { role: "assistant", content: boundContent(reply) } : null;
}

// What a new window keeps of the conversation, so the user's words do not depend on the agent's notes.
// Set `replies` only when the task is at rest: a request ending on an assistant message reads as a
// prefill to some providers, and a working agent has its own notes on what it has said.
export function selectRolloverSeedItems(items: ResponseInputItem[], options: { replies: boolean }): ResponseInputItem[] {
  const seeds: ResponseInputItem[] = [];
  let usedChars = 0;
  let replyTaken = false;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const seed = toSeedItem(items[index], options.replies, replyTaken);
    if (!seed) continue;
    usedChars += (seed as { content: string }).content.length;
    if (usedChars > MAX_SEED_TOTAL_CHARS) break;
    seeds.unshift(seed);
    // Each user message keeps only the last thing said in reply to it.
    replyTaken = (seed as { role: string }).role === "assistant";
  }
  return seeds;
}
