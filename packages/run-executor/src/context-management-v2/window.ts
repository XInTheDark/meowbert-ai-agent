import { randomUUID } from "node:crypto";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { ContextHistoryRecord, RunContextStore } from "../agent/ports/run-control.js";
import { mergeContextSeedItems } from "./history.js";
import { getProviderCallId, readOutputCallNumber } from "./call-numbers.js";
import { applyContextEdits } from "./context-edits.js";
import { buildContextWindowPrompt, buildThreadHint, getContextBudgetPromptState } from "./prompts.js";
import type { ContextManagementState, ContextManagementV2State } from "./types.js";

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function addOpaqueItemMarker(item: ResponseInputItem, id: string): void {
  const record = getRecord(item);
  if (record.role !== "user" && record.role !== "system" && record.role !== "developer") return;
  const marker = `[id: ${id}]`;
  for (const field of ["content", "output"] as const) {
    const value = record[field];
    if (typeof value !== "string" || value.includes(marker)) continue;
    record[field] = `${value}\n${marker}`;
    return;
  }
}

// Gives each item its history id and, unless `preserveItems` is set, appends the id marker the
// agent uses to reference it. Markers are written into the items in place, so the live
// conversation carries the same text that history stores.
// `callNumbers` numbers tool calls recorded before their output; outputs carry their own number.
export function prepareContextHistoryRecords(
  items: ResponseInputItem[],
  options: RecordContextItemsOptions = {}
): ContextHistoryRecord[] {
  return items.map((item) => {
    const id = randomUUID();
    if (!options.preserveItems) addOpaqueItemMarker(item, id);
    const callId = getProviderCallId(item);
    const callNumber = (callId ? options.callNumbers?.get(callId) : undefined) ?? readOutputCallNumber(item);
    return { id, item, ...(callNumber !== null ? { callNumber } : {}) };
  });
}

interface RecordContextItemsOptions {
  preserveItems?: boolean;
  callNumbers?: ReadonlyMap<string, number>;
}

// `preserveItems` stores items exactly as given, without history id markers; a swarm lane's inherited
// history must stay byte-identical to its parent's request so it reads the parent's cached prefix.
export async function recordContextItems(
  store: RunContextStore,
  state: ContextManagementV2State,
  items: ResponseInputItem[],
  options: RecordContextItemsOptions = {}
): Promise<void> {
  if (items.length === 0) return;
  await store.recordItems(state, prepareContextHistoryRecords(items, options));
}

export async function resolveContextManagementState(store: RunContextStore, input: {
  taskId: string;
  requestedVersion: "v1" | "v2";
  runtimeModel: string;
  branchLeafMessageId: string | null;
  seedItems: ResponseInputItem[];
  skipHistoryReplay?: boolean;
}): Promise<{ state: ContextManagementState; conversationItems: ResponseInputItem[] }> {
  const version = await store.freezeVersion(input.requestedVersion, input.runtimeModel);
  if (version !== "v2") {
    return { state: { version: "v1" }, conversationItems: input.seedItems };
  }

  const window = await store.openWindow(input.branchLeafMessageId);
  const state: ContextManagementV2State = {
    version: "v2",
    taskId: input.taskId,
    firstWindowId: window.firstWindowId,
    windowId: window.windowId,
    contextNodeId: window.contextNodeId,
    previousWindowId: window.previousWindowId,
    branchLeafMessageId: input.branchLeafMessageId,
    reminderSent: false,
    fallbackSent: false,
    pendingReset: false,
    recoveryPhase: "normal"
  };
  if (input.skipHistoryReplay) {
    return { state, conversationItems: [] };
  }
  const existing = await store.loadWindowItems(state.windowId);
  // Seeds hold the original calls, so they are merged with the window's unedited history first.
  const merged = mergeContextSeedItems(existing, input.seedItems);
  Object.assign(state, getContextBudgetPromptState(merged.conversationItems));
  await recordContextItems(store, state, merged.newItems);
  return { state, conversationItems: applyContextEdits(merged.conversationItems) };
}

export async function buildV2WindowDeveloperItems(store: RunContextStore, input: {
  state: ContextManagementV2State;
  agentName: string;
}): Promise<ResponseInputItem[]> {
  const hint = buildThreadHint(await store.loadNotesSummary(input.state.contextNodeId));
  return [{ role: "developer", content: buildContextWindowPrompt({ state: input.state, agentName: input.agentName, threadHint: hint }) }];
}

export async function startNewContextWindow(store: RunContextStore, input: {
  state: ContextManagementV2State;
  branchLeafMessageId: string | null;
  reason: string;
}): Promise<ContextManagementV2State> {
  const window = await store.startNewWindow(input.state, input.branchLeafMessageId, input.reason);
  return {
    ...input.state,
    windowId: window.windowId,
    contextNodeId: window.contextNodeId,
    previousWindowId: input.state.windowId,
    branchLeafMessageId: input.branchLeafMessageId,
    reminderSent: false,
    fallbackSent: false,
    pendingReset: false,
    recoveryPhase: "normal"
  };
}

export async function linkContextNodeToVisibleMessage(store: RunContextStore, input: {
  state: ContextManagementV2State;
  visibleMessageId: string;
}): Promise<ContextManagementV2State> {
  return { ...input.state, contextNodeId: await store.linkVisibleMessage(input.state, input.visibleMessageId) };
}

export async function searchContextNotes(store: RunContextStore, state: ContextManagementV2State, input: {
  query: string;
  path_prefix?: string | null;
  max_files?: number | null;
  max_matches_per_file?: number | null;
  recent_file_first?: boolean | null;
}) {
  const listed = await store.listNotes(state, {
    prefix: input.path_prefix,
    max_results: input.max_files,
    file_order_by: "updated_at",
    file_order: input.recent_file_first ? "descending" : "ascending"
  });
  const matchesPerFile = Math.min(100, Math.max(1, Math.floor(input.max_matches_per_file ?? 20)));
  const files = await Promise.all(listed.files.map(async (file) => {
    const note = await store.readNote(state, { path: file.path });
    const lines = typeof note.content === "string" ? note.content.split("\n") : [];
    const matches = lines.flatMap((line, index) => line.includes(input.query) ? [{ line: index + 1, content: line }] : []).slice(0, matchesPerFile);
    return matches.length > 0 ? { path: file.path, matches } : null;
  }));
  return { files: files.filter((file): file is NonNullable<typeof file> => file !== null) };
}
