import { parseInlineArtifact, serializeInlineArtifact } from "@meowbert/shared/inline-artifacts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function pickInlineArtifact(content: Record<string, unknown>): Record<string, unknown> | null {
  const directArtifact = parseInlineArtifact(content.inline_artifact);
  if (directArtifact) {
    return serializeInlineArtifact(directArtifact);
  }

  const functionOutput = isRecord(content.response_function_output) ? content.response_function_output.output : null;
  const functionArtifact = parseInlineArtifact(functionOutput);
  if (functionArtifact) {
    return serializeInlineArtifact(functionArtifact);
  }

  const customOutput = isRecord(content.response_custom_tool_output) ? content.response_custom_tool_output.output : null;
  const customArtifact = parseInlineArtifact(customOutput);
  return customArtifact ? serializeInlineArtifact(customArtifact) : null;
}

export function selectTaskMessageMetadataContent(
  role: string,
  content: Record<string, unknown>
): Record<string, unknown> {
  if (role !== "tool") {
    return {};
  }

  const metadata: Record<string, unknown> = {};
  const toolName = asTrimmedString(content.tool);
  const callId = asTrimmedString(content.callId);
  const durationMs = asFiniteNumber(content.durationMs);
  const inlineArtifact = pickInlineArtifact(content);

  if (toolName) {
    metadata.tool = toolName;
  }
  if (callId) {
    metadata.callId = callId;
  }
  if (durationMs !== null) {
    metadata.durationMs = durationMs;
  }
  if (inlineArtifact) {
    metadata.inline_artifact = inlineArtifact;
  }

  return metadata;
}
