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

// A tool call here is answered with null and the turn goes on, so the handoff still comes from the
// same cached conversation; past this many rounds the caller falls back to its own summary.
const MAX_HANDOFF_ROUNDS = 3;

function answerToolCalls(output: unknown[]): ResponseInputItem[] {
  return output.flatMap((item): ResponseInputItem[] => {
    const record = item as { type?: unknown; call_id?: unknown };
    if (typeof record.call_id !== "string") return [];
    if (record.type === "function_call") return [{ type: "function_call_output" as const, call_id: record.call_id, output: "null" }];
    if (record.type === "custom_tool_call") return [{ type: "custom_tool_call_output" as const, call_id: record.call_id, output: "null" }];
    return [];
  });
}

// Asks the parent's model, as one more turn of its conversation, for a handoff of `items` (the
// conversation the parent's last request sent). It runs as its own session forked from the parent's,
// so a session-resuming proxy (Meridian) starts from the parent's transcript and the parent's session
// is left as it was. Returns null when no handoff came back.
export async function summarizeFromParentTurn(
  parent: ParentTurnRequest,
  items: ResponseInputItem[]
): Promise<string | null> {
  const conversationItems: ResponseInputItem[] = [...items, { role: "user", content: FORK_SUMMARY_NOTE }];
  const sessionAffinityKey = buildPromptCacheKey(parent.sessionAffinityKey, `fork-summary:${randomUUID()}`);
  for (let round = 0; round < MAX_HANDOFF_ROUNDS; round += 1) {
    const { response } = await createModelResponse({
      ...parent,
      conversationItems,
      sessionAffinityKey,
      forkSourceSessionKey: parent.sessionAffinityKey
    });
    const toolOutputs = answerToolCalls(response.output);
    if (toolOutputs.length === 0) {
      const text = readAssistantText(response.output);
      return text.length > 0 ? text : null;
    }
    conversationItems.push(...(response.output as ResponseInputItem[]), ...toolOutputs);
  }
  return null;
}
