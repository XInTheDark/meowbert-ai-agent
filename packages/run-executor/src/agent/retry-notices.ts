import type { TaskMessageRow } from "./types.js";

// Retry notices tell the user that a request or run failed and will be retried. The model never
// sees them during the run, so replaying them would put items into history the provider never saw,
// ahead of model output the failed run saves later.
export const RETRY_NOTICE_KIND = "retry_notice";

const LEGACY_RETRY_NOTICE_PREFIXES = ["Model request failed (attempt ", "Task run failed (attempt "];

export function isRetryNoticeMessage(message: Pick<TaskMessageRow, "role" | "content_json">): boolean {
  if (message.role !== "system") return false;
  if (message.content_json.kind === RETRY_NOTICE_KIND) return true;
  const text = message.content_json.text;
  return typeof text === "string" && LEGACY_RETRY_NOTICE_PREFIXES.some((prefix) => text.startsWith(prefix));
}
