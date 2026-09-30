import { parseInlineArtifact, type InlineArtifact } from "@meowbert/shared/inline-artifacts";
import type { TaskMessage } from "../lib/types";

export type TaskInlineArtifact = InlineArtifact;

export function parseTaskInlineArtifactOutput(output: unknown): TaskInlineArtifact | null {
  return parseInlineArtifact(output);
}

export function getTaskInlineArtifact(message: TaskMessage): TaskInlineArtifact | null {
  const directArtifact = parseInlineArtifact(message.content_json.inline_artifact);
  if (directArtifact) {
    return directArtifact;
  }

  const functionOutput = parseInlineArtifact(
    isRecord(message.content_json.response_function_output)
      ? message.content_json.response_function_output.output
      : null
  );
  if (functionOutput) {
    return functionOutput;
  }

  return parseInlineArtifact(
    isRecord(message.content_json.response_custom_tool_output)
      ? message.content_json.response_custom_tool_output.output
      : null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
