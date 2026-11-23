import { randomUUID } from "node:crypto";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { createModelResponse, type CreateModelResponseInput } from "../agent/model.js";
import { buildPromptCacheKey } from "../agent/turn-request.js";

// The request a turn just sent, without its conversation: replayed with the same prefix, tools, tool
// choice and cache key, a summary of that conversation reads the cache the turn wrote.
export type ParentTurnRequest = Omit<CreateModelResponseInput, "conversationItems" | "forkSourceSessionKey" | "purpose"> & {
  sessionAffinityKey: string;
};

const FORK_SUMMARY_REQUEST = [
  "Part of this work is moving to a fresh context that will not see this conversation.",
  "Write the handoff it will continue from: what the user wants, their recent requests in their own words, what is done, what you found, the files and commands that matter, and what is still open."
].join(" ");

function readHandoffToolText(output: unknown[], toolName: string | undefined): string | null {
  if (!toolName) return null;
  for (const item of output) {
    const call = item as { type?: string; name?: string; arguments?: string };
    if (call.type !== "function_call" || call.name !== toolName || typeof call.arguments !== "string") continue;
    try {
      const args = JSON.parse(call.arguments);
      const text = toolName === "submit" ? args.summary : args.response;
      if (typeof text === "string" && text.trim()) return text.trim();
    } catch { /* A malformed call is answered below, allowing the model to try again. */ }
  }
  return null;
}

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
const PENDING_FORK_OUTPUT = "Preparing a handoff summary for the forked lanes before starting them.";

function answerToolCalls(output: unknown[]): ResponseInputItem[] {
  return output.flatMap((item): ResponseInputItem[] => {
    const record = item as { type?: unknown; call_id?: unknown };
    if (typeof record.call_id !== "string") return [];
    if (record.type === "function_call") return [{ type: "function_call_output" as const, call_id: record.call_id, output: "null" }];
    if (record.type === "custom_tool_call") return [{ type: "custom_tool_call_output" as const, call_id: record.call_id, output: "null" }];
    return [];
  });
}

// Settles the pending fork call(s) in `items` so the handoff request is a valid tool-result
// continuation of the parent's last assistant turn (preserving prefix and session-resuming caches).
function answerUnansweredToolCalls(items: ResponseInputItem[]): ResponseInputItem[] {
  const answered = new Set<string>();
  for (const item of items) {
    const record = item as { type?: unknown; call_id?: unknown };
    if (typeof record.call_id !== "string") continue;
    if (record.type === "function_call_output" || record.type === "custom_tool_call_output") {
      answered.add(record.call_id);
    }
  }
  return items.flatMap((item): ResponseInputItem[] => {
    const record = item as { type?: unknown; call_id?: unknown };
    if (typeof record.call_id !== "string" || answered.has(record.call_id)) return [];
    if (record.type === "function_call") {
      return [{ type: "function_call_output" as const, call_id: record.call_id, output: PENDING_FORK_OUTPUT }];
    }
    if (record.type === "custom_tool_call") {
      return [{ type: "custom_tool_call_output" as const, call_id: record.call_id, output: PENDING_FORK_OUTPUT }];
    }
    return [];
  });
}

// Asks the parent's model, as one more turn of its conversation, for a handoff of `items` (including
// the parent's last assistant response, with any pending fork call answered). It runs as its own
// session forked from the parent's, so a session-resuming proxy (Meridian) resumes from the parent's
// transcript and leaves the parent's session untouched. Returns null when no handoff came back.
export async function summarizeFromParentTurn(
  parent: ParentTurnRequest,
  items: ResponseInputItem[]
): Promise<string | null> {
  const required = parent.toolChoice !== undefined && parent.toolChoice !== "auto";
  const handoffTool = required ? parent.tools.find((tool) => tool.type === "function"
    && (tool.name === "submit" || tool.name === "final_response")
    && (typeof parent.toolChoice !== "object" || tool.name === parent.toolChoice.name)) : undefined;
  const handoffToolName = handoffTool?.type === "function" ? handoffTool.name : undefined;
  const responseInstruction = handoffToolName
    ? `Return the handoff in ${handoffToolName === "submit" ? "submit's summary" : "final_response's response"}. This call only collects text; it does not submit work or finish the original run.`
    : "Reply with the handoff as plain text and call no tools.";
  const note = `[System: ${FORK_SUMMARY_REQUEST} ${responseInstruction} Nothing you write here reaches the user.]`;
  const conversationItems: ResponseInputItem[] = [...items, ...answerUnansweredToolCalls(items), { role: "user", content: note }];
  const sessionAffinityKey = buildPromptCacheKey(parent.sessionAffinityKey, `fork-summary:${randomUUID()}`);
  for (let round = 0; round < MAX_HANDOFF_ROUNDS; round += 1) {
    const { response } = await createModelResponse({
      ...parent,
      toolChoice: required && !handoffToolName ? "auto" : parent.toolChoice,
      conversationItems,
      sessionAffinityKey,
      forkSourceSessionKey: parent.sessionAffinityKey
    });
    const handoff = readHandoffToolText(response.output, handoffToolName);
    if (handoff) return handoff;
    const toolOutputs = answerToolCalls(response.output);
    if (toolOutputs.length === 0) {
      const text = readAssistantText(response.output);
      return text.length > 0 ? text : null;
    }
    conversationItems.push(...(response.output as ResponseInputItem[]), ...toolOutputs);
  }
  return null;
}
