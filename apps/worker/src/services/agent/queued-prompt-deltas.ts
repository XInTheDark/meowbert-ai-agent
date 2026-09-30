import type { ResponseInputItem } from "openai/resources/responses/responses";
import { recordContextItems } from "../context-management-v2/index.js";
import type { AgentExecutionContext } from "./execution-types.js";
import {
  drainPromptEnvelopeConversationDeltas,
  restorePromptEnvelopeDeltasToPrefix,
  type PromptEnvelope
} from "./prompt-envelope.js";

const appendedDeltaItems = new WeakMap<PromptEnvelope, Map<string, ResponseInputItem>>();

// Matches by role and text so notes reloaded from history still count as present; the v2 history
// id marker appended to recorded items is ignored.
function noteKey(item: ResponseInputItem): string {
  const record = item as { role?: unknown; content?: unknown };
  const content = typeof record.content === "string" ? record.content.replace(/\n\[id: [^\]]+\]$/, "") : "";
  return `${String(record.role)}\u0000${content}`;
}

function restoreDroppedDeltas(envelope: PromptEnvelope, conversationItems: ResponseInputItem[]): void {
  const appended = appendedDeltaItems.get(envelope);
  if (!appended || appended.size === 0) return;
  const present = new Set(conversationItems.map(noteKey));
  const dropped = new Set([...appended].filter(([, item]) => !present.has(noteKey(item))).map(([id]) => id));
  for (const id of dropped) appended.delete(id);
  restorePromptEnvelopeDeltasToPrefix(envelope, dropped);
}

// Appends prompt notes raised after the prefix was sealed (skill enabled, canvas created, ...) at a
// model-turn boundary, so they never split a tool call from its output or rewrite the cached prefix.
// Notes are written to history so later runs replay them in place; run-scoped ones are not.
export async function appendQueuedPromptDeltas(execution: AgentExecutionContext): Promise<void> {
  const envelope = execution.promptEnvelope;
  const state = execution.state;
  restoreDroppedDeltas(envelope, state.dispatchState.conversationItems);
  const drained = drainPromptEnvelopeConversationDeltas(envelope);
  if (drained.length === 0) return;
  const appended = appendedDeltaItems.get(envelope) ?? new Map<string, ResponseInputItem>();
  appendedDeltaItems.set(envelope, appended);
  for (const { delta, item } of drained) appended.set(delta.id, item);
  state.dispatchState.conversationItems.push(...drained.map(({ item }) => item));
  const persisted = drained.filter(({ delta }) => !delta.runScoped).map(({ item }) => item);
  if (persisted.length === 0) return;
  state.dispatchState.runPersistedItems.push(...persisted);
  if (state.contextManagement.version === "v2") await recordContextItems(state.contextManagement, persisted);
}
