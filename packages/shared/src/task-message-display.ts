import { buildInlineResponseArtifactIdentities, buildInlineResponseSegments } from "./task-message-display-segments.js";
import { buildRunInboxReportCards } from "./task-message-display-reports.js";
import { extractResponseItemsText } from "./task-message-display-text.js";
import { buildResponseThoughtSummaries } from "./task-message-display-thoughts.js";
import { buildResponseToolMessages } from "./task-message-display-tools.js";
import type { DisplaySourceMessage, TaskMessageDisplay } from "./task-message-display-types.js";

export type * from "./task-message-display-types.js";
export { getInlineArtifactIdentity } from "./task-message-display-segments.js";

export function buildTaskMessageDisplay(message: DisplaySourceMessage): TaskMessageDisplay | null {
  const responseItems = message.content_json.response_items;
  if (!Array.isArray(responseItems)) {
    return null;
  }

  const toolMessages = buildResponseToolMessages(message);
  return {
    tool_messages: toolMessages,
    thought_summaries: buildResponseThoughtSummaries(message),
    inline_segments: buildInlineResponseSegments(message, toolMessages),
    inline_artifact_identities: buildInlineResponseArtifactIdentities(message, toolMessages),
    report_cards: buildRunInboxReportCards(message),
    final_text: extractResponseItemsText(responseItems)
  };
}

// Replaces a stored message's raw model response items with the display data the conversation UI uses.
export function toDisplayTaskMessage<T extends DisplaySourceMessage>(
  message: T
): T & { display?: TaskMessageDisplay } {
  const display = buildTaskMessageDisplay(message);
  if (!display) {
    return message;
  }

  const { response_items: _responseItems, ...content } = message.content_json;
  return { ...message, content_json: content, display };
}
