import type { ContextManagementV2State } from "./types.js";

const THREAD_HINT_MAX_BYTES = 4_000;

export const CONTEXT_WINDOW_GUIDANCE = `<context_window_guidance>
For tasks that may span context windows, use notes to maintain a concise checkpoint of the goal, decisions, progress, learnings and next steps. Include the window ID and item ID for every relevant user request you are currently solving, as well as important actions and tool calls. Use history to look up details through those references later. Note that every non-assistant item, such as user, developer, tool response, has an item id \`[id: ...]\` that is immediately after its item content.

Take incremental notes while you work so important details are not missed. Use get_context_remaining when useful. Once the token budget is exhausted, the current window is unavailable and recovery is through notes and history.

When a previous context window ID is present, a reset occurred. Read the checkpoint, then use history to recover missing exact material. Prefer history_read_item when the window and item IDs are known; otherwise locate them with history_list_items or history_search_contents.

Treat notes and history as internal bookkeeping. Do not mention them in user-facing messages.
</context_window_guidance>`;

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
    lines.push("notes/continuity.md:", truncateUtf8(input.continuity, THREAD_HINT_MAX_BYTES));
  }
  if (input.index.length > 0) {
    lines.push("Available notes:", ...input.index.map((entry) => `${entry.path} (${entry.size} bytes, ${entry.updatedAt})`));
  }
  return lines.length > 0 ? truncateUtf8(lines.join("\n"), THREAD_HINT_MAX_BYTES) : null;
}

export function buildContextReminder(tokensLeft: number): string {
  return `<context_window_reminder>\nYour current context window is nearly exhausted; only ${tokensLeft} tokens remain. Before starting a new context window, save concise progress notes with the notes tool: the goal, decisions, progress, learnings, next steps, every relevant user request's window and item IDs, and important actions or tool calls. Future context windows will not automatically include this conversation. After saving your state, call new_context to continue in a fresh context window.\n</context_window_reminder>`;
}

export const CONTEXT_EXHAUSTED_FALLBACK = `<context_window_reminder>
The current context window is exhausted. Do not continue the task or give a final answer in this window. The next window will not automatically include this conversation. Make exactly one write or append call to notes now to save a concise checkpoint with the goal, decisions, progress, learnings, next steps, every relevant user request's window and item IDs, and important actions or tool calls. After the notes result returns, call new_context; do not use any tools other than notes and new_context.
</context_window_reminder>`;
