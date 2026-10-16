import type { DisplaySourceMessage, ResponseThoughtSummary } from "./task-message-display-types.js";

const TOOL_CALL_ITEM_TYPES = new Set(["function_call", "custom_tool_call", "apply_patch_call", "web_search_call"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isReasoningResponseItem(value: unknown): value is Record<string, unknown> & { type: "reasoning" } {
  return isRecord(value) && value.type === "reasoning";
}

function getToolCallItemId(item: unknown): string | null {
  if (!isRecord(item) || typeof item.type !== "string" || !TOOL_CALL_ITEM_TYPES.has(item.type)) {
    return null;
  }
  return item.type === "web_search_call" ? asString(item.id) : asString(item.call_id) ?? asString(item.id);
}

function extractReasoningSummaryText(item: Record<string, unknown>): string | null {
  const rawSummary = item.summary;
  if (!Array.isArray(rawSummary)) {
    return null;
  }

  const parts = rawSummary
    .map((entry) => {
      if (!isRecord(entry) || entry.type !== "summary_text") {
        return null;
      }
      const text = asString(entry.text)?.trim();
      return text && text.length > 0 ? text : null;
    })
    .filter((value): value is string => typeof value === "string");

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n\n");
}

export function buildResponseThoughtSummaries(message: DisplaySourceMessage): ResponseThoughtSummary[] {
  if (message.role !== "assistant") {
    return [];
  }

  const rawItems = message.content_json.response_items;
  if (!Array.isArray(rawItems)) {
    return [];
  }

  const summaries: ResponseThoughtSummary[] = [];
  rawItems.forEach((item, index) => {
    if (!isReasoningResponseItem(item)) {
      return;
    }

    const text = extractReasoningSummaryText(item);
    if (!text) {
      return;
    }

    if (summaries[summaries.length - 1]?.text === text) {
      return;
    }

    summaries.push({
      id: `${message.id}:response-thought:${asString(item.id) ?? index}`,
      text,
      nextCallIds: rawItems.slice(index + 1)
        .map(getToolCallItemId)
        .filter((callId): callId is string => callId !== null)
    });
  });

  return summaries;
}
