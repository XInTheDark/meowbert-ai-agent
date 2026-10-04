import type { LiveToolCall, TaskMessage } from "../lib/types";

function readSummary(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// The model leaves out summaries for routine steps, so a trail holds only the ones it wrote,
// without repeating the step just before.
function collectSteps(summaries: Array<string | null>): string[] {
  const steps: string[] = [];
  for (const summary of summaries) {
    if (summary && summary !== steps[steps.length - 1]) {
      steps.push(summary);
    }
  }
  return steps;
}

export function getToolMessageStepSummary(message: TaskMessage): string | null {
  return readSummary(message.content_json?.summary);
}

export function getToolGroupStepSummaries(toolGroup: TaskMessage[]): string[] {
  return collectSteps(toolGroup.map(getToolMessageStepSummary));
}

export function getLiveToolCallStepSummaries(liveToolCalls: LiveToolCall[]): string[] {
  return collectSteps(liveToolCalls.map((liveCall) => readSummary(liveCall.summary)));
}
