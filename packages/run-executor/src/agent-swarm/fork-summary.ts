import { randomUUID } from "node:crypto";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { createModelResponse, type CreateModelResponseInput } from "../agent/model.js";
import { buildPromptCacheKey } from "../agent/turn-request.js";

// The request a turn just sent, without its conversation: replayed with the same prefix, tools, tool
// choice and cache key, a summary of that conversation reads the cache the turn wrote.
export type ParentTurnRequest = Omit<CreateModelResponseInput, "conversationItems" | "forkSourceSessionKey" | "purpose"> & {
  sessionAffinityKey: string;
};

const FORK_SUMMARY_NOTE = "[System: " + [
  "Part of this work is moving to a fresh context that will not see this conversation.",
  "Write the handoff it will continue from: what the user wants, their recent requests in their own words, what is done, what you found, the files and commands that matter, and what is still open.",
  "Reply with the handoff as plain text and call no tools. Nothing you write here reaches the user."
].join(" ") + "]";

function readAssistantText(output: unknown[]): string {
  return output.flatMap((item) => {
    const record = item as { type?: unknown; role?: unknown; content?: unknown };
    if (record.type !== "message" || record.role !== "assistant" || !Array.isArray(record.content)) return [];
    return record.content.flatMap((part) => {
      const text = (part as { type?: unknown; text?: unknown });
      return text.type === "output_text" && typeof text.text === "string" ? [text.text] : [];
    });
  }).join("\n").trim();
}

// Asks the parent's model, as one more turn of its conversation, for a handoff of `items` (the
// conversation the parent's last request sent). It runs as its own session forked from the parent's,
// so a session-resuming proxy (Meridian) starts from the parent's transcript and the parent's session
// is left as it was. Returns null when the model calls a tool instead of answering.
export async function summarizeFromParentTurn(
  parent: ParentTurnRequest,
  items: ResponseInputItem[]
): Promise<string | null> {
  const { response } = await createModelResponse({
    ...parent,
    conversationItems: [...items, { role: "user", content: FORK_SUMMARY_NOTE }],
    sessionAffinityKey: buildPromptCacheKey(parent.sessionAffinityKey, `fork-summary:${randomUUID()}`),
    forkSourceSessionKey: parent.sessionAffinityKey
  });
  if (response.output.some((item) => item.type !== "message" && item.type !== "reasoning")) return null;
  const text = readAssistantText(response.output);
  return text.length > 0 ? text : null;
}
