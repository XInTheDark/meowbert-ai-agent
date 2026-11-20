import type { ResponseInputItem } from "openai/resources/responses/responses";
import { collectCallNumbers, isToolOutputItem, readOutputCallNumber, segmentConversationTurns } from "./call-numbers.js";

const MAX_TURN_CHARS = 24_000;
const MAX_HANDOFF_OUTPUTS = 100;
const HANDOFF_PREFIX = "[System: Context rollover retained unread tool outcomes.";

function compactOutput(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length <= 500 ? value : `${value.slice(0, 500)} [excerpt; read full history]`;
  if (!value || typeof value !== "object") return value;
  if (depth >= 4) return "[nested data; read full history]";
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => compactOutput(item, depth + 1));
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "context")
    .sort(([left], [right]) => Number(/status|success|error|receipt|id$|url|path/i.test(right)) - Number(/status|success|error|receipt|id$|url|path/i.test(left)))
    .slice(0, 20)
    .map(([key, item]) => [key, compactOutput(item, depth + 1)]));
}

function outputExcerpt(output: unknown, maxChars: number): string {
  const text = typeof output === "string" ? output : JSON.stringify(output) ?? "";
  if (text.length <= maxChars) return text;
  let compacted: string;
  try { compacted = JSON.stringify(compactOutput(JSON.parse(text))); }
  catch { compacted = text; }
  return compacted.length <= maxChars ? compacted : `${compacted.slice(0, maxChars)} [excerpt; read full history]`;
}

// The latest model turn's outputs have not been consumed by another model turn.
// Keep a complete paired turn when small; otherwise carry its outcomes and exact
// history coordinates rather than silently replacing them with older notes.
export function selectRolloverToolItems(items: ResponseInputItem[], windowId: string, portable = false): ResponseInputItem[] {
  const turn = segmentConversationTurns(items, collectCallNumbers(items)).at(-1);
  let handoffIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const record = items[index] as { content?: unknown };
    if (typeof record.content === "string" && record.content.startsWith(HANDOFF_PREFIX)) {
      handoffIndex = index;
      break;
    }
  }
  if (handoffIndex >= 0 && (!turn || handoffIndex > turn.end)) return [items[handoffIndex]];
  const turnItems = turn ? items.slice(turn.start, turn.end + 1) : items;
  const outputs = turnItems.filter(isToolOutputItem);
  if (outputs.length === 0) return [];
  const answered = new Set(outputs.map((item) => (item as { call_id: string }).call_id));
  const providerSpecific = turnItems.some((item) => ["reasoning", "compaction", "web_search_call", "custom_tool_call", "apply_patch_call"]
    .includes(String(item.type)));
  if (turn?.calls.length && turn.calls.every((call) => answered.has(call.callId))
    && (!portable || !providerSpecific) && JSON.stringify(turnItems).length <= MAX_TURN_CHARS) return turnItems;
  const maxOutputChars = Math.min(2_000, Math.max(100, Math.floor(12_000 / outputs.length)));
  const outcomes = outputs.slice(0, MAX_HANDOFF_OUTPUTS).map((item) => {
    const record = item as unknown as Record<string, unknown>;
    const callId = String(record.call_id);
    return {
      window_id: windowId,
      call_number: readOutputCallNumber(item),
      call_id: callId,
      tool: turn?.calls.find((call) => call.callId === callId)?.name ?? record.type,
      completion: record.status ?? "output_returned",
      output: outputExcerpt(record.output, maxOutputChars)
    };
  });
  return [{ role: "user", content: `${HANDOFF_PREFIX} These calls already returned; use their recorded results before deciding whether more work is needed. Full outputs and any omitted data are in history window ${windowId}; use history_read_item with call_number, or find call_id in that window's history file. Outcome excerpts follow.]\n${JSON.stringify({
    outcomes, ...(outputs.length > outcomes.length ? { additional_outputs: outputs.length - outcomes.length, history_window_id: windowId } : {})
  })}` }];
}
