import type { TaskMessage } from "../lib/types";
import { getInlineArtifactIdentity, type InlineResponseSegment } from "@meowbert/shared/task-message-display";
import { getTaskInlineArtifact } from "./taskInlineArtifacts";

export type { InlineResponseSegment };
export { getInlineArtifactIdentity };

export type InlineArtifactIdentity = string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function getTaskInlineArtifactMessageIdentity(message: TaskMessage): InlineArtifactIdentity | null {
  const artifact = getTaskInlineArtifact(message);
  if (!artifact) {
    return null;
  }

  return getInlineArtifactIdentity(artifact, getResponseToolCallId(message));
}

export function getInlineResponseArtifactIdentities(message: TaskMessage): Set<InlineArtifactIdentity> {
  return new Set(message.display?.inline_artifact_identities ?? []);
}

export function getInlineResponseSegments(message: TaskMessage): InlineResponseSegment[] {
  const segments = [...(message.display?.inline_segments ?? [])];
  const hasArtifactSegment = segments.some((segment) => segment.kind === "artifact");
  const hasTextSegment = segments.some((segment) => segment.kind === "text");
  const fallbackText = typeof message.content_json.text === "string" ? message.content_json.text.trim() : "";
  if (message.role === "assistant" && hasArtifactSegment && !hasTextSegment && fallbackText.length > 0) {
    segments.push({ kind: "text", id: `${message.id}:text`, text: fallbackText });
  }

  return segments;
}
