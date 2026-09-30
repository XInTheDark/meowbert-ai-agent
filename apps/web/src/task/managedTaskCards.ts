import type { TaskMessage } from "../lib/types";

export interface ManagedTaskCardData {
  taskId: string;
  action: "created" | "started" | "reported";
  fallbackTitle: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseToolOutput(message: TaskMessage): Record<string, unknown> | null {
  const output = asRecord(message.content_json.response_function_output)?.output;
  if (typeof output !== "string") return null;
  try {
    return asRecord(JSON.parse(output));
  } catch {
    return null;
  }
}

// The Master's create_task and message_task calls that launched work surface as a task card instead of tool activity.
export function getManagedTaskCard(message: TaskMessage): ManagedTaskCardData | null {
  const tool = message.content_json.tool;
  if (tool !== "create_task" && tool !== "message_task") return null;
  const output = parseToolOutput(message);
  if (!output || typeof output.task_id !== "string") return null;
  if (tool === "message_task" && output.delivery !== "started") return null;
  const inputText = typeof message.content_json.inputText === "string" ? message.content_json.inputText.trim() : "";
  return {
    taskId: output.task_id,
    action: tool === "create_task" ? "created" : "started",
    fallbackTitle: tool === "create_task" && inputText ? inputText : null
  };
}

const REPORT_PATTERN = /^\[Task report\] "([^"\n]*)" \(([0-9a-f-]{36})\)/;

// Reports and other mail delivered to the run are stored as system messages with no text of their own.
// Returns null for ordinary messages, and the report cards for a delivery (empty if it held no task reports).
export function getRunInboxReportCards(message: TaskMessage): ManagedTaskCardData[] | null {
  if (message.role !== "system" || message.content_json.text !== "" || message.content_json.kind) return null;
  const items = message.content_json.response_items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const cards: ManagedTaskCardData[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (!record || record.role !== "user" || typeof record.content !== "string") return null;
    const match = REPORT_PATTERN.exec(record.content);
    if (match) cards.push({ taskId: match[2], action: "reported", fallbackTitle: match[1] || null });
  }
  return cards;
}
