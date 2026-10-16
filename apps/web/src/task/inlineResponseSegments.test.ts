import { toDisplayTaskMessage } from "@meowbert/shared/task-message-display";
import { describe, expect, it } from "vitest";
import type { TaskMessage } from "../lib/types";
import { getInlineResponseSegments } from "./inlineResponseSegments";

function assistantMessage(responseItems: unknown[]): TaskMessage {
  return toDisplayTaskMessage({
    id: "message-1",
    role: "assistant",
    content_json: { text: "Waiting for Worker 1.", response_items: responseItems },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: "2026-10-14T00:00:00.000Z"
  } as TaskMessage);
}

function finalResponseCall(callId: string, response: string): Record<string, unknown> {
  return {
    type: "function_call",
    name: "final_response",
    call_id: callId,
    arguments: JSON.stringify({ response, notify: true, partial: false })
  };
}

describe("getInlineResponseSegments", () => {
  it("does not render a final_response the worker rejected", () => {
    const segments = getInlineResponseSegments(assistantMessage([
      finalResponseCall("call-final", "The answer is M."),
      {
        type: "function_call_output",
        call_id: "call-final",
        output: JSON.stringify({ error: "The final swarm review is missing." })
      }
    ]));

    expect(segments).toEqual([]);
  });

  it("renders an accepted final_response", () => {
    const segments = getInlineResponseSegments(assistantMessage([
      finalResponseCall("call-final", "The answer is M."),
      {
        type: "function_call_output",
        call_id: "call-final",
        output: JSON.stringify({ acknowledged: true, notify: true, partial: false })
      }
    ]));

    expect(segments).toEqual([{ kind: "text", id: "message-1:partial:call-final", text: "The answer is M." }]);
  });
});
