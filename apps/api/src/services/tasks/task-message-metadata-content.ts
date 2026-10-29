import { parseInlineArtifact, serializeInlineArtifact } from "@meowbert/shared/inline-artifacts";
import { normalizeTaskProgress } from "@meowbert/shared/task-progress";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string") ? value : null;
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
  const summary = asTrimmedString(content.summary);
  const progress = normalizeTaskProgress(content.progress);
  const artifactPaths = asStringList(content.artifact_paths);
  const removedArtifactPaths = asStringList(content.removed_artifact_paths);

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
  if (summary) {
    metadata.summary = summary;
  }
  if (progress) {
    metadata.progress = progress;
  }
  // The activity card lists the files a turn marked as artifacts.
  if (artifactPaths) {
    metadata.artifact_paths = artifactPaths;
  }
  if (removedArtifactPaths) {
    metadata.removed_artifact_paths = removedArtifactPaths;
  }

  return metadata;
}
