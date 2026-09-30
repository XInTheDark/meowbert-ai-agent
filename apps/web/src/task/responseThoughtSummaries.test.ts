import { describe, expect, it } from "vitest";
import { getResponseThoughtSummaries } from "./responseThoughtSummaries";
import type { TaskMessage } from "../lib/types";

describe("getResponseThoughtSummaries", () => {
  it("extracts reasoning summaries from assistant response items", () => {
    const message: TaskMessage = {
      id: "msg_assistant_1",
      role: "assistant",
      content_json: {
        text: "Done.",
        response_items: [
          {
            type: "reasoning",
            id: "rs_1",
            summary: [
              { type: "summary_text", text: "Checked the task requirements." },
              { type: "summary_text", text: "Planned the next coding step." }
            ]
          },
          { type: "message", id: "out_1", role: "assistant", content: [] }
        ]
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-10T06:00:00.000Z"
    };

    expect(getResponseThoughtSummaries(message)).toEqual([
      {
        id: "msg_assistant_1:response-thought:rs_1",
        text: "Checked the task requirements.\n\nPlanned the next coding step."
      }
    ]);
  });

  it("ignores empty reasoning summaries and non-assistant messages", () => {
    const message: TaskMessage = {
      id: "msg_user_1",
      role: "user",
      content_json: {
        response_items: [
          {
            type: "reasoning",
            id: "rs_ignored",
            summary: [{ type: "summary_text", text: "Should not render." }]
          },
          { type: "reasoning", id: "rs_empty", summary: [] }
        ]
      },
      parent_message_id: null,
      edited_from_message_id: null,
      created_at: "2026-03-10T06:00:00.000Z"
    };

    expect(getResponseThoughtSummaries(message)).toEqual([]);
  });
});
