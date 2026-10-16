import type { ResponseThoughtSummary } from "@meowbert/shared/task-message-display";
import type { TaskMessage } from "../lib/types";

export type { ResponseThoughtSummary };

export function getResponseThoughtSummaries(message: TaskMessage): ResponseThoughtSummary[] {
  return message.display?.thought_summaries ?? [];
}
