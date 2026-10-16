import type { DisplaySourceMessage, RunInboxReportCard } from "./task-message-display-types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const REPORT_PATTERN = /^\[Task report\] "([^"\n]*)" \(([0-9a-f-]{36})\)/;

// Reports and other mail delivered to the run are stored as system messages with no text of their own.
// Returns null for ordinary messages, and the report cards for a delivery (empty if it held no task reports).
export function buildRunInboxReportCards(message: DisplaySourceMessage): RunInboxReportCard[] | null {
  if (message.role !== "system" || message.content_json.text !== "" || message.content_json.kind) return null;
  const items = message.content_json.response_items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const cards: RunInboxReportCard[] = [];
  for (const item of items) {
    const record = asRecord(item);
    if (!record || record.role !== "user" || typeof record.content !== "string") return null;
    const match = REPORT_PATTERN.exec(record.content);
    if (match) cards.push({ taskId: match[2], action: "reported", fallbackTitle: match[1] || null });
  }
  return cards;
}
