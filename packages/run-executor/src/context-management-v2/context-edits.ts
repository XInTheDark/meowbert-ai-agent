import type { ResponseInputItem } from "openai/resources/responses/responses";
import {
  collectCallNumbers,
  isShownItem,
  isToolOutputItem,
  readOutputCallNumber,
  segmentConversationTurns,
  type ConversationTurn
} from "./call-numbers.js";

// A context edit replaces a range of tool calls with a summary. The summary is a developer item
// whose JSON names the range; it is appended to history like any other item, and the window is
// derived by applying every summary to the items before it. Applying is idempotent, so the live
// conversation and a window rebuilt from history come out the same, and history keeps the
// originals.

export interface ContextEditRequest {
  fromCallNumber: number;
  toCallNumber: number;
  keepArguments: boolean;
  inputSummary: string | null;
  outputSummary: string;
}

interface ContextEditPayload {
  from_call_number: number;
  to_call_number: number;
  tools: Record<string, number>;
  arguments_kept: boolean;
  input_summary: string | null;
  output_summary: string;
  // The calls that requested the edit; their whole turn is folded into this summary.
  edited_by_call_numbers?: number[];
}

const EDIT_PREFIX = "{\"context_edit\":";
const STUB_KEY = "replaced_by_context_edit";

function getRecord(item: ResponseInputItem): Record<string, unknown> {
  return item as unknown as Record<string, unknown>;
}

export function readContextEdit(item: ResponseInputItem): ContextEditPayload | null {
  const record = getRecord(item);
  if (record.role !== "developer" || typeof record.content !== "string" || !record.content.startsWith(EDIT_PREFIX)) return null;
  try {
    return (JSON.parse(record.content) as { context_edit: ContextEditPayload }).context_edit;
  } catch {
    return null;
  }
}

function inRange(callNumber: number | null, from: number, to: number): boolean {
  return callNumber !== null && callNumber >= from && callNumber <= to;
}

function turnsWithCalls(turns: ConversationTurn[], matches: (callNumber: number | null) => boolean): ConversationTurn[] {
  return turns.filter((turn) => turn.calls.some((call) => matches(call.callNumber)));
}

function countTools(turns: ConversationTurn[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const call of turns.flatMap((turn) => turn.calls)) counts[call.name] = (counts[call.name] ?? 0) + 1;
  return counts;
}

function describeRange(from: number, to: number): string {
  return from === to ? `call ${from}` : `calls ${from}-${to}`;
}

// Why a request cannot be applied to `items`, or null when it can.
export function validateContextEdit(items: ResponseInputItem[], request: ContextEditRequest, options: {
  knownCallNumbers?: ReadonlyMap<string, number>;
  requestingCallId: string;
  allowedRequestToolNames: ReadonlySet<string>;
  pending: ContextEditRequest[];
}): string | null {
  const { fromCallNumber: from, toCallNumber: to } = request;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    return "from_call_number and to_call_number must be whole numbers with from_call_number <= to_call_number.";
  }
  const overlapping = options.pending.find((edit) => edit.fromCallNumber <= to && from <= edit.toCallNumber);
  if (overlapping) {
    return `This range overlaps ${describeRange(overlapping.fromCallNumber, overlapping.toCallNumber)}, which is already being replaced.`;
  }
  const turns = segmentConversationTurns(items, collectCallNumbers(items, options.knownCallNumbers));
  const requestingTurn = turns.find((turn) => turn.calls.some((call) => call.callId === options.requestingCallId));
  const otherCall = requestingTurn?.calls.find((call) => !options.allowedRequestToolNames.has(call.name));
  if (otherCall) {
    return `Make context edits in a turn of their own; this turn also calls ${otherCall.name}.`;
  }
  const rangeTurns = turnsWithCalls(turns, (callNumber) => inRange(callNumber, from, to));
  if (rangeTurns.length === 0) {
    return `No ${describeRange(from, to)} in the current context.`;
  }
  if (requestingTurn && rangeTurns.includes(requestingTurn)) {
    return "The range must end before the call that requests the edit.";
  }
  const split = rangeTurns.find((turn) => turn.calls.some((call) => !inRange(call.callNumber, from, to)));
  if (split) {
    const numbers = split.calls.map((call) => call.callNumber ?? "?").join(", ");
    return `Calls ${numbers} were made together; the range must include all of them or none.`;
  }
  const start = rangeTurns[0].start;
  const end = rangeTurns[rangeTurns.length - 1].end;
  const userItemIndex = items.findIndex((item, index) => index > start && index < end
    && getRecord(item).role === "user"
    && !isShownItem(item));
  if (userItemIndex >= 0) {
    return `${describeRange(from, to)} span a user message, which cannot be replaced. End the range before it or start after it.`;
  }
  return null;
}

export function buildContextEditItem(items: ResponseInputItem[], request: ContextEditRequest, editedByCallNumbers: number[] | null): ResponseInputItem {
  const turns = segmentConversationTurns(items, collectCallNumbers(items));
  const payload: ContextEditPayload = {
    from_call_number: request.fromCallNumber,
    to_call_number: request.toCallNumber,
    tools: countTools(turnsWithCalls(turns, (callNumber) => inRange(callNumber, request.fromCallNumber, request.toCallNumber))),
    arguments_kept: request.keepArguments,
    input_summary: request.keepArguments ? null : request.inputSummary,
    output_summary: request.outputSummary,
    ...(editedByCallNumbers && editedByCallNumbers.length > 0 ? { edited_by_call_numbers: editedByCallNumbers } : {})
  };
  return { role: "developer", content: JSON.stringify({ context_edit: payload }) };
}

function stubOutput(item: ResponseInputItem, edit: ContextEditPayload): ResponseInputItem {
  const range = `${edit.from_call_number}-${edit.to_call_number}`;
  return { ...item, output: JSON.stringify({ call_number: readOutputCallNumber(item), [STUB_KEY]: range }) } as ResponseInputItem;
}

function isStubbed(item: ResponseInputItem): boolean {
  const output = getRecord(item).output;
  return typeof output === "string" && output.includes(`"${STUB_KEY}"`);
}

function indicesOf(turns: ConversationTurn[], matches: (index: number) => boolean = () => true): Set<number> {
  const indices = new Set<number>();
  for (const turn of turns) {
    for (let index = turn.start; index <= turn.end; index += 1) if (matches(index)) indices.add(index);
  }
  return indices;
}

function applyContextEdit(items: ResponseInputItem[], editItem: ResponseInputItem, edit: ContextEditPayload): ResponseInputItem[] {
  const turns = segmentConversationTurns(items, collectCallNumbers(items));
  const rangeTurns = turnsWithCalls(turns, (callNumber) => inRange(callNumber, edit.from_call_number, edit.to_call_number));
  const editedBy = new Set(edit.edited_by_call_numbers ?? []);
  const requestTurns = turnsWithCalls(turns, (callNumber) => callNumber !== null && editedBy.has(callNumber))
    .filter((turn) => !rangeTurns.includes(turn));
  const removed = indicesOf(requestTurns);
  const stubbed = new Set<number>();
  if (edit.arguments_kept) {
    for (const index of indicesOf(rangeTurns)) {
      if (isShownItem(items[index])) removed.add(index);
      else if (isToolOutputItem(items[index]) && !isStubbed(items[index])) stubbed.add(index);
    }
  } else {
    for (const index of indicesOf(rangeTurns)) removed.add(index);
  }
  // Earlier summaries of calls inside this range are folded into this one, which takes the place
  // of the first of them.
  const absorbed: number[] = [];
  for (let index = 0; index < items.length && items[index] !== editItem; index += 1) {
    const inner = readContextEdit(items[index]);
    if (inner && inner.from_call_number >= edit.from_call_number && inner.to_call_number <= edit.to_call_number) {
      absorbed.push(index);
      removed.add(index);
    }
  }
  if (removed.size === 0 && stubbed.size === 0) return items;

  const anchor = edit.arguments_kept && rangeTurns.length > 0
    ? rangeTurns[rangeTurns.length - 1].end
    : Math.min(...absorbed, ...[...rangeTurns, ...requestTurns].map((turn) => turn.start));
  const result: ResponseInputItem[] = [];
  items.forEach((item, index) => {
    if (item === editItem) return;
    if (!edit.arguments_kept && index === anchor) result.push(editItem);
    if (!removed.has(index)) result.push(stubbed.has(index) ? stubOutput(item, edit) : item);
    if (edit.arguments_kept && index === anchor) result.push(editItem);
  });
  return result;
}

// The window as the model sees it: every summary applied, in the order the edits were made.
export function applyContextEdits(items: ResponseInputItem[]): ResponseInputItem[] {
  let result = items;
  for (const item of items) {
    const edit = readContextEdit(item);
    if (edit) result = applyContextEdit(result, item, edit);
  }
  return result;
}
