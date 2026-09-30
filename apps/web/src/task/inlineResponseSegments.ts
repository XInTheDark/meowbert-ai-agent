import type { TaskMessage } from "../lib/types";
import { getResponseToolMessages } from "./responseToolMessages";
import { getTaskInlineArtifact, type TaskInlineArtifact } from "./taskInlineArtifacts";

export type InlineResponseSegment =
  | {
      kind: "text";
      id: string;
      text: string;
    }
  | {
      kind: "artifact";
      id: string;
      artifact: TaskInlineArtifact;
    };

export type InlineArtifactIdentity = string;

const MIN_FINAL_RESPONSE_OVERLAP_CHARS = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMaybeJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseFinalResponseArguments(value: unknown): { response: string; partial: boolean } | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = parseMaybeJson(value);
  if (!isRecord(parsed) || typeof parsed.response !== "string") {
    return null;
  }

  return {
    response: parsed.response.trim(),
    partial: parsed.partial === true
  };
}

function isInlineResponseToolCallItem(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (value.type === "function_call" || value.type === "custom_tool_call");
}

function isFinalResponseItem(value: unknown): boolean {
  return isRecord(value) && value.type === "function_call" && value.name === "final_response";
}

function findLargestTextOverlap(left: string, right: string): number {
  const maxOverlap = Math.min(left.length, right.length);
  for (let overlap = maxOverlap; overlap >= MIN_FINAL_RESPONSE_OVERLAP_CHARS; overlap -= 1) {
    if (left.endsWith(right.slice(0, overlap))) {
      return overlap;
    }
  }

  return 0;
}

function appendFinalResponseTextSegment(current: string, next: string): string {
  if (current.length === 0) {
    return next;
  }
  if (next.length === 0 || current.endsWith(next)) {
    return current;
  }
  if (next.startsWith(current)) {
    return next;
  }

  const overlap = findLargestTextOverlap(current, next);
  if (overlap > 0) {
    return `${current}${next.slice(overlap)}`;
  }

  return `${current}\n\n${next}`;
}

function getInlineResponseWindowItems(items: unknown[]): unknown[] {
  let lastFinalIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!isFinalResponseItem(items[index])) {
      continue;
    }

    const parsed = parseFinalResponseArguments((items[index] as { arguments?: unknown }).arguments);
    if (parsed && !parsed.partial) {
      lastFinalIndex = index;
      break;
    }
  }

  if (lastFinalIndex === -1) {
    return items;
  }

  let previousFinalIndex = -1;
  for (let index = lastFinalIndex - 1; index >= 0; index -= 1) {
    if (!isFinalResponseItem(items[index])) {
      continue;
    }

    const parsed = parseFinalResponseArguments((items[index] as { arguments?: unknown }).arguments);
    if (parsed && !parsed.partial) {
      previousFinalIndex = index;
      break;
    }
  }

  return items.slice(previousFinalIndex + 1, lastFinalIndex + 1);
}

function pushTextSegment(segments: InlineResponseSegment[], id: string, text: string): void {
  const previous = segments[segments.length - 1];
  if (previous?.kind !== "text") {
    segments.push({ kind: "text", id, text });
    return;
  }

  previous.text = appendFinalResponseTextSegment(previous.text, text);
}

function getResponseToolCallId(message: TaskMessage): string | null {
  if (typeof message.content_json.callId === "string" && message.content_json.callId.trim().length > 0) {
    return message.content_json.callId.trim();
  }

  const functionOutput = isRecord(message.content_json.response_function_output)
    ? message.content_json.response_function_output
    : null;
  if (typeof functionOutput?.call_id === "string" && functionOutput.call_id.trim().length > 0) {
    return functionOutput.call_id.trim();
  }

  const customOutput = isRecord(message.content_json.response_custom_tool_output)
    ? message.content_json.response_custom_tool_output
    : null;
  if (typeof customOutput?.call_id === "string" && customOutput.call_id.trim().length > 0) {
    return customOutput.call_id.trim();
  }

  const functionCall = isRecord(message.content_json.response_function_call)
    ? message.content_json.response_function_call
    : null;
  if (typeof functionCall?.call_id === "string" && functionCall.call_id.trim().length > 0) {
    return functionCall.call_id.trim();
  }

  const customCall = isRecord(message.content_json.response_custom_tool_call)
    ? message.content_json.response_custom_tool_call
    : null;
  return typeof customCall?.call_id === "string" && customCall.call_id.trim().length > 0
    ? customCall.call_id.trim()
    : null;
}

export function getInlineArtifactIdentity(
  artifact: TaskInlineArtifact,
  callId: string | null = null
): InlineArtifactIdentity {
  const normalizedCallId = callId?.trim();
  if (normalizedCallId) {
    return `call:${normalizedCallId}`;
  }

  return `artifact:${artifact.type}:${artifact.relativePath}`;
}

export function getTaskInlineArtifactMessageIdentity(message: TaskMessage): InlineArtifactIdentity | null {
  const artifact = getTaskInlineArtifact(message);
  if (!artifact) {
    return null;
  }

  return getInlineArtifactIdentity(artifact, getResponseToolCallId(message));
}

export function getInlineResponseArtifactIdentities(message: TaskMessage): Set<InlineArtifactIdentity> {
  const identities = new Set<InlineArtifactIdentity>();
  if (message.role !== "assistant" || !Array.isArray(message.content_json.response_items)) {
    return identities;
  }

  const toolMessagesByCallId = new Map<string, TaskMessage>();
  for (const toolMessage of getResponseToolMessages(message)) {
    const callId = typeof toolMessage.content_json.callId === "string" ? toolMessage.content_json.callId : null;
    if (callId) {
      toolMessagesByCallId.set(callId, toolMessage);
    }
  }

  message.content_json.response_items.forEach((item, index) => {
    if (!isInlineResponseToolCallItem(item)) {
      return;
    }

    const callId = typeof item.call_id === "string" ? item.call_id : `call-${index}`;
    const artifact = getTaskInlineArtifact(toolMessagesByCallId.get(callId) ?? ({ content_json: {} } as TaskMessage));
    if (artifact) {
      identities.add(getInlineArtifactIdentity(artifact, callId));
      identities.add(getInlineArtifactIdentity(artifact));
    }
  });

  return identities;
}

export function getInlineResponseSegments(message: TaskMessage): InlineResponseSegment[] {
  if (message.role !== "assistant" || !Array.isArray(message.content_json.response_items)) {
    return [];
  }

  const toolMessagesByCallId = new Map<string, TaskMessage>();
  for (const toolMessage of getResponseToolMessages(message)) {
    const callId = typeof toolMessage.content_json.callId === "string" ? toolMessage.content_json.callId : null;
    if (callId) {
      toolMessagesByCallId.set(callId, toolMessage);
    }
  }

  const segments: InlineResponseSegment[] = [];
  getInlineResponseWindowItems(message.content_json.response_items).forEach((item, index) => {
    if (!isInlineResponseToolCallItem(item)) {
      return;
    }

    const callId = typeof item.call_id === "string" ? item.call_id : `call-${index}`;
    const name = typeof item.name === "string" ? item.name : null;
    if (item.type === "function_call" && name === "final_response") {
      const parsed = parseFinalResponseArguments(item.arguments);
      if (parsed && parsed.response.length > 0) {
        pushTextSegment(segments, `${message.id}:partial:${callId}`, parsed.response);
      }
      return;
    }

    const artifact = getTaskInlineArtifact(toolMessagesByCallId.get(callId) ?? ({ content_json: {} } as TaskMessage));
    if (artifact) {
      segments.push({ kind: "artifact", id: `${message.id}:artifact:${callId}`, artifact });
    }
  });

  const hasArtifactSegment = segments.some((segment) => segment.kind === "artifact");
  const hasTextSegment = segments.some((segment) => segment.kind === "text");
  const fallbackText = typeof message.content_json.text === "string" ? message.content_json.text.trim() : "";
  if (hasArtifactSegment && !hasTextSegment && fallbackText.length > 0) {
    segments.push({ kind: "text", id: `${message.id}:text`, text: fallbackText });
  }

  return segments;
}
