import { createHash } from "node:crypto";
import type { ResponseInputItem, Tool } from "openai/resources/responses/responses";

/*
 * Prompt caching contract
 *
 * Providers cache the longest unchanged start of a request (tools, then this envelope's prefix,
 * then the conversation). Any change in the prefix re-bills everything after it, so:
 *
 * - The prefix is the base system prompt plus deltas added during run setup. Setup deltas must be
 *   stable across runs of the same task: no timestamps, recent-turn lists or other per-message
 *   state. Put per-message state in a tool result or the conversation instead.
 * - The envelope is sealed when the first model request of a run is built. Deltas added after that
 *   (skill enabled, canvas created, computer availability, ...) are queued and appended to the end
 *   of the conversation at the next turn boundary (see queued-prompt-deltas.ts), so they never land
 *   between a tool call and its output.
 * - Queued deltas are saved with the run's response items, so later runs replay them in the same
 *   position and history only ever grows. `runScoped` deltas are not saved because the next run's
 *   setup recreates them (timed-run wrap-up, quick-mode switch and the skills it auto-enables).
 * - If a conversation rebuild (compaction, context-window reset) drops a queued delta, it moves back
 *   into the prefix; the prefix changes at that point anyway, so no cached prefix is lost.
 * - Deltas are skipped when the latest delta with the same reason has the same content, so
 *   per-step notices are not repeated.
 *
 * The prefix hash also keys requests: turn-request.ts derives `prompt_cache_key` from the task id and
 * prefix hash, and model.ts sends the same key as `x-session-affinity`. Proxies that resume upstream
 * sessions (e.g. Meridian, which requires append-only history per key) rely on that header; each
 * proxy hop must forward it.
 */

export interface PromptEnvelopeFrame {
  id: string;
  role: "developer" | "system";
  content: string;
}

export interface PromptEnvelopeDelta extends PromptEnvelopeFrame {
  reason: string;
  createdAt: string;
  // Run-scoped notes are recreated by the next run's setup, so they are not written to history.
  runScoped?: boolean;
}

export interface PromptEnvelope {
  baseVersion: string;
  baseFrames: PromptEnvelopeFrame[];
  deltas: PromptEnvelopeDelta[];
  // After the first model request the prefix is frozen so it stays cacheable; later deltas are
  // queued here and appended to the conversation at the next turn boundary instead.
  sealed: boolean;
  conversationDeltas: PromptEnvelopeDelta[];
  drainedConversationDeltaCount: number;
}

const DEFAULT_PROMPT_BASE_VERSION = "task-agent-base-v1";

function normalizePromptContent(content: string): string {
  return content.trim();
}

function toInputItem(frame: PromptEnvelopeFrame): ResponseInputItem {
  return {
    role: frame.role,
    content: frame.content
  };
}

function serializeUnknownStable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => serializeUnknownStable(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serializeUnknownStable(objectValue[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function serializeToolForSignature(tool: Tool): Record<string, unknown> {
  const toolRecord = tool as unknown as Record<string, unknown>;
  const type = typeof toolRecord.type === "string" ? toolRecord.type : "unknown";
  const name = typeof toolRecord.name === "string" ? toolRecord.name : null;

  return {
    type,
    name,
    payload: toolRecord
  };
}

function toolSignatureSortKey(serializedTool: Record<string, unknown>): string {
  const type = typeof serializedTool.type === "string" ? serializedTool.type : "unknown";
  const name = typeof serializedTool.name === "string" ? serializedTool.name : "";
  return `${type}:${name}`;
}

export function createPromptEnvelope(systemPrompt: string, baseVersion = DEFAULT_PROMPT_BASE_VERSION): PromptEnvelope {
  const content = normalizePromptContent(systemPrompt);

  return {
    baseVersion,
    baseFrames: [
      {
        id: `${baseVersion}:base:1`,
        role: "developer",
        content
      }
    ],
    deltas: [],
    sealed: false,
    conversationDeltas: [],
    drainedConversationDeltaCount: 0
  };
}

function findLatestDelta(envelope: PromptEnvelope, reason: string): PromptEnvelopeDelta | undefined {
  const all = [...envelope.deltas, ...envelope.conversationDeltas];
  for (let index = all.length - 1; index >= 0; index -= 1) {
    if (all[index].reason === reason) {
      return all[index];
    }
  }
  return undefined;
}

export function appendPromptEnvelopeDelta(
  envelope: PromptEnvelope,
  input: {
    reason: string;
    content: string;
    role?: "developer" | "system";
    runScoped?: boolean;
  }
): PromptEnvelopeDelta | null {
  const content = normalizePromptContent(input.content);
  if (content.length === 0) {
    return null;
  }

  const role = input.role ?? "system";
  const latest = findLatestDelta(envelope, input.reason);
  if (latest && latest.role === role && latest.content === content) {
    return null;
  }

  const target = envelope.sealed ? envelope.conversationDeltas : envelope.deltas;
  const delta: PromptEnvelopeDelta = {
    id: `${envelope.baseVersion}:delta:${envelope.deltas.length + envelope.conversationDeltas.length + 1}`,
    role,
    reason: input.reason,
    content,
    createdAt: new Date().toISOString(),
    ...(input.runScoped ? { runScoped: true } : {})
  };

  target.push(delta);
  return delta;
}

export function sealPromptEnvelope(envelope: PromptEnvelope): void {
  envelope.sealed = true;
}

export function drainPromptEnvelopeConversationDeltas(envelope: PromptEnvelope): Array<{
  delta: PromptEnvelopeDelta;
  item: ResponseInputItem;
}> {
  const pending = envelope.conversationDeltas.slice(envelope.drainedConversationDeltaCount);
  envelope.drainedConversationDeltaCount = envelope.conversationDeltas.length;
  return pending.map((delta) => ({ delta, item: toInputItem(delta) }));
}

// Moves drained deltas back into the prefix when a conversation rebuild (compaction, window reset)
// dropped their items; the prefix changes at that point anyway, so no cached prefix is lost.
export function restorePromptEnvelopeDeltasToPrefix(envelope: PromptEnvelope, deltaIds: ReadonlySet<string>): void {
  if (deltaIds.size === 0) return;
  const drained = envelope.conversationDeltas.slice(0, envelope.drainedConversationDeltaCount);
  const pending = envelope.conversationDeltas.slice(envelope.drainedConversationDeltaCount);
  envelope.deltas.push(...drained.filter((delta) => deltaIds.has(delta.id)));
  envelope.conversationDeltas = [...drained.filter((delta) => !deltaIds.has(delta.id)), ...pending];
  envelope.drainedConversationDeltaCount = envelope.conversationDeltas.length - pending.length;
}

export function promptEnvelopeToPrefixItems(envelope: PromptEnvelope): ResponseInputItem[] {
  return [...envelope.baseFrames, ...envelope.deltas].map((frame) => toInputItem(frame));
}

export function getPromptEnvelopeRevision(envelope: PromptEnvelope): string {
  return `${envelope.baseVersion}+d${envelope.deltas.length}`;
}

export function computePromptPrefixHash(input: {
  envelope: PromptEnvelope;
  tools: Tool[];
}): string {
  const serializedTools = input.tools
    .map((tool) => serializeToolForSignature(tool))
    .sort((left, right) => toolSignatureSortKey(left).localeCompare(toolSignatureSortKey(right)));

  const serialized = serializeUnknownStable({
    baseVersion: input.envelope.baseVersion,
    frames: [...input.envelope.baseFrames, ...input.envelope.deltas].map((frame) => ({
      id: frame.id,
      role: frame.role,
      content: frame.content
    })),
    tools: serializedTools
  });

  return createHash("sha256").update(serialized).digest("hex").slice(0, 20);
}
