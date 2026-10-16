import type { InlineArtifact } from "./inline-artifacts.js";

export interface DisplaySourceMessage {
  id: string;
  role: string;
  content_json: Record<string, unknown>;
  parent_message_id: string | null;
  edited_from_message_id: string | null;
  created_at: string;
}

export interface DisplayToolMessage {
  id: string;
  role: "tool";
  content_json: Record<string, unknown>;
  parent_message_id: string | null;
  edited_from_message_id: null;
  created_at: string;
}

export interface ResponseThoughtSummary {
  id: string;
  text: string;
  // Call ids of the tool calls that follow this thought in the same response, in order.
  nextCallIds: string[];
}

export interface RunInboxReportCard {
  taskId: string;
  action: "reported";
  fallbackTitle: string | null;
}

export type InlineResponseSegment =
  | {
      kind: "text";
      id: string;
      text: string;
    }
  | {
      kind: "artifact";
      id: string;
      artifact: InlineArtifact;
    };

// What the conversation UI needs from a message's stored model response items, built on the server
// so the raw items (which can hold base64 images and other model-only input) never reach the browser.
export interface TaskMessageDisplay {
  tool_messages: DisplayToolMessage[];
  thought_summaries: ResponseThoughtSummary[];
  inline_segments: InlineResponseSegment[];
  inline_artifact_identities: string[];
  // Null for ordinary messages; the report cards (possibly none) for a run inbox delivery.
  report_cards: RunInboxReportCard[] | null;
  final_text: string;
}
