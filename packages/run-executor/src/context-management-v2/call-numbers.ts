import type { ResponseInputItem } from "openai/resources/responses/responses";

// Every top-level tool call gets a task-wide number, shown to the model as `call_number` in the
// call's output. The output is the durable record: numbers are read back from it when a window is
// rebuilt, so nothing else has to carry them.

const CALL_TYPES = new Set(["function_call", "custom_tool_call", "apply_patch_call", "computer_call", "local_shell_call"]);
const MODEL_ITEM_TYPES = new Set([...CALL_TYPES, "reasoning", "web_search_call"]);
// The number is always the output's first key, so numbers quoted inside a result never match.
const CALL_NUMBER_PATTERN = /^\{"call_number":(\d+)[,}]/;

function getRecord(item: ResponseInputItem): Record<string, unknown> {
  return item as unknown as Record<string, unknown>;
}

export function getProviderCallId(item: ResponseInputItem): string | null {
  const callId = getRecord(item).call_id;
  return typeof callId === "string" ? callId : null;
}

export function isToolCallItem(item: ResponseInputItem): boolean {
  const type = getRecord(item).type;
  return typeof type === "string" && CALL_TYPES.has(type) && getProviderCallId(item) !== null;
}

export function isToolOutputItem(item: ResponseInputItem): boolean {
  const type = getRecord(item).type;
  return typeof type === "string" && type.endsWith("_call_output") && getProviderCallId(item) !== null;
}

// Items a model response produced: reasoning, assistant text and tool calls.
export function isModelItem(item: ResponseInputItem): boolean {
  const record = getRecord(item);
  return (typeof record.type === "string" && MODEL_ITEM_TYPES.has(record.type)) || record.role === "assistant";
}

// Images and files a tool showed the model right after its output.
export function isShownItem(item: ResponseInputItem): boolean {
  const record = getRecord(item);
  return record.role === "user" && Array.isArray(record.content);
}

export function readOutputCallNumber(item: ResponseInputItem): number | null {
  if (!isToolOutputItem(item)) return null;
  const output = getRecord(item).output;
  if (typeof output !== "string") return null;
  const match = output.match(CALL_NUMBER_PATTERN);
  return match ? Number(match[1]) : null;
}

// Provider call id -> call number, for every numbered output in `items`.
export function collectCallNumbers(items: ResponseInputItem[], known?: ReadonlyMap<string, number>): Map<string, number> {
  const numbers = new Map(known ?? []);
  for (const item of items) {
    const callNumber = readOutputCallNumber(item);
    const callId = getProviderCallId(item);
    if (callNumber !== null && callId) numbers.set(callId, callNumber);
  }
  return numbers;
}

export function getHighestCallNumber(items: ResponseInputItem[]): number {
  return Math.max(0, ...collectCallNumbers(items).values());
}

export interface ConversationTurn {
  start: number;
  // Inclusive index of the turn's last call, output or shown item.
  end: number;
  calls: Array<{ callId: string; callNumber: number | null; name: string }>;
}

// Splits the conversation into model turns: one response's items followed by the outputs and shown
// items of its calls. Items outside every turn (user, developer, system) are left out.
export function segmentConversationTurns(items: ResponseInputItem[], callNumbers: ReadonlyMap<string, number>): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn | null = null;
  let inOutputs = false;
  items.forEach((item, index) => {
    if (isModelItem(item)) {
      if (!current || inOutputs) {
        current = { start: index, end: index, calls: [] };
        turns.push(current);
        inOutputs = false;
      }
      current.end = index;
      if (isToolCallItem(item)) {
        const callId = getProviderCallId(item) as string;
        const record = getRecord(item);
        const name = typeof record.name === "string" ? record.name : String(record.type).replace(/_call$/, "");
        current.calls.push({ callId, callNumber: callNumbers.get(callId) ?? null, name });
      }
      return;
    }
    if (current && (isToolOutputItem(item) || (inOutputs && isShownItem(item)))) {
      current.end = index;
      inOutputs = true;
      return;
    }
    current = null;
    inOutputs = false;
  });
  return turns;
}
