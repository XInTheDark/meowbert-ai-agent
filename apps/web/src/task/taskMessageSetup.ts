import type { TaskMessage, TaskToolOptions } from "../lib/types";
import { normalizeToolOptions } from "./taskInputDrafts";
import { getTaskMessageAgentId } from "./taskModelSelection";

export interface TaskMessageSetup {
  messageId: string;
  toolOptions: TaskToolOptions;
  agentId: string | null;
}

// The tools and agent of the task's latest user message, which is what its next run uses unless a
// follow-up changes them. Messages store only the tools that were on.
export function readLatestTaskMessageSetup(messages: readonly TaskMessage[]): TaskMessageSetup | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const tools = message.content_json.tools;
    return {
      messageId: message.id,
      toolOptions: normalizeToolOptions({
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        interactiveCanvas: false,
        enabledSkills: [],
        enabledSources: [],
        ...(tools && typeof tools === "object" && !Array.isArray(tools) ? tools : {})
      }),
      agentId: getTaskMessageAgentId(message)
    };
  }
  return null;
}
