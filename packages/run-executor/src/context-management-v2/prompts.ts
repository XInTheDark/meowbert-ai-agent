import type { ContextManagementV2State } from "./types.js";
import type { ResponseInputItem } from "openai/resources/responses/responses";

const CONTINUITY_NOTE_PATH = "continuity.md";
const CONTINUITY_HINT_MAX_BYTES = 16_000;
const NOTES_INDEX_MAX_BYTES = 4_000;

function buildHistoryAccessGuidance(options: { historySearch: boolean; historyFiles: boolean }): string {
  const search = options.historySearch ? " When you don't know the exact text, find it with history_search." : "";
  if (!options.historyFiles) {
    return `Every context window of this task is kept. When a previous context window ID is present, a reset occurred. Read the checkpoint, then recover missing exact material with history_read_item, using a window ID with an item ID or call_number.${search}`;
  }
  return `Every context window of this task is a read-only JSONL file in $TASK_HISTORY_DIR, named \`<ordinal>-<window id>.jsonl\`, with one line per item: \`id\`, \`call_number\`, \`role\`, \`type\`, \`tool\` and \`content\`. Read them with rg, jq or sed. When a previous context window ID is present, a reset occurred. Read the checkpoint, then recover missing exact material from the history files, for example \`rg <item id> $TASK_HISTORY_DIR\`.${search}`;
}

// Fixed for a run: history_search is offered only when the admin has session history search on, and
// history files need a shell, which the Project Master never gets.
export function buildContextWindowGuidance(options: { historySearch: boolean; historyFiles: boolean }): string {
  return `<context_window_guidance>
For tasks that may span context windows, keep a concise checkpoint in the note \`${CONTINUITY_NOTE_PATH}\` with the goal, decisions, progress, learnings and next steps. Include the window ID and item ID for every relevant user request you are currently solving, as well as important actions and tool calls. Use the context history to look up details through those references later. User and developer items have an item id \`[id: ...]\` immediately after their content, and every tool output starts with its \`call_number\`.

A new window opens with the first ${CONTINUITY_HINT_MAX_BYTES / 1_000} KB of \`${CONTINUITY_NOTE_PATH}\` and your recent user messages, which may already be handled, so check the checkpoint before acting on them. Other notes are only listed by name.

Take incremental notes while you work so important details are not missed.

Keep the window lean with context_replace_calls. When you finish a stretch of work whose raw output you no longer need, such as exploring part of a codebase or reading material, replace those calls with the key findings and any exact snippets you will reuse. Do it right after them, never for calls far back in the window. Use get_context_remaining when useful. Once the token budget is exhausted, the current window is unavailable and recovery is through notes and the context history.

${buildHistoryAccessGuidance(options)}

Treat notes and the context history as internal bookkeeping. Do not mention them in user-facing messages.
</context_window_guidance>`;
}

export function truncateUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) {
    return value;
  }
  let truncated = buffer.subarray(0, maxBytes).toString("utf8");
  while (Buffer.byteLength(truncated, "utf8") > maxBytes) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

export function buildContextWindowPrompt(input: {
  state: ContextManagementV2State;
  agentName: string;
  threadHint: string | null;
}): string {
  const lines = [
    "<context_window>",
    `Agent name: ${input.agentName}`,
    `First context window id: ${input.state.firstWindowId}`,
    `Current context window id: ${input.state.windowId}`
  ];
  if (input.state.previousWindowId) {
    lines.push(`Previous context window id: ${input.state.previousWindowId}`);
  }
  if (input.threadHint) {
    lines.push(input.threadHint);
  }
  lines.push("</context_window>");
  return lines.join("\n");
}

export function buildThreadHint(input: {
  continuity: string | null;
  index: Array<{ path: string; size: number; updatedAt: string }>;
}): string | null {
  const lines: string[] = [];
  if (input.continuity) {
    const opening = truncateUtf8(input.continuity, CONTINUITY_HINT_MAX_BYTES);
    lines.push(`${CONTINUITY_NOTE_PATH}:`, opening);
    if (opening !== input.continuity) {
      lines.push(`[truncated at ${CONTINUITY_HINT_MAX_BYTES} bytes; read the rest with notes_read_file]`);
    }
  }
  if (input.index.length > 0) {
    const index = input.index.map((entry) => `${entry.path} (${entry.size} bytes, ${entry.updatedAt})`);
    lines.push(truncateUtf8(["Available notes:", ...index].join("\n"), NOTES_INDEX_MAX_BYTES));
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export function buildContextReminder(tokensLeft: number): string {
  return `<context_window_reminder>\nYour current context window is nearly exhausted; only ${tokensLeft} tokens remain. Before starting a new context window, save concise progress to the note ${CONTINUITY_NOTE_PATH}: the goal, decisions, progress, learnings, next steps, every relevant user request's window and item IDs, and important actions or tool calls. Future context windows will not automatically include this conversation. After saving your state, call new_context to continue in a fresh context window.\n</context_window_reminder>`;
}

const CONTEXT_EXHAUSTED_OPENING = "<context_window_reminder>\nThe current context window is exhausted.";

export const CONTEXT_EXHAUSTED_FALLBACK = `${CONTEXT_EXHAUSTED_OPENING} Do not continue the task or give a final answer in this window. The next window will not automatically include this conversation. Make exactly one write or append call to the note ${CONTINUITY_NOTE_PATH} now to save a concise checkpoint with the goal, decisions, progress, learnings, next steps, every relevant user request's window and item IDs, and important actions or tool calls. After the notes result returns, call new_context; do not use any tools other than notes and new_context.
</context_window_reminder>`;

export function getContextBudgetPromptState(items: ResponseInputItem[]): { reminderSent: boolean; fallbackSent: boolean } {
  const prompts = items.flatMap((item) => {
    const record = item as { role?: string; content?: unknown };
    return record.role === "developer" && typeof record.content === "string" ? [record.content] : [];
  });
  return {
    reminderSent: prompts.some((text) => text.startsWith("<context_window_reminder>")),
    fallbackSent: prompts.some((text) => text.startsWith(CONTEXT_EXHAUSTED_OPENING))
  };
}
