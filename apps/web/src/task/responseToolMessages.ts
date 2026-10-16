import type { TaskMessage } from "../lib/types";

// Tool calls made inside an assistant response, as tool messages the conversation can render.
export function getResponseToolMessages(message: TaskMessage): TaskMessage[] {
  return message.display?.tool_messages ?? [];
}
