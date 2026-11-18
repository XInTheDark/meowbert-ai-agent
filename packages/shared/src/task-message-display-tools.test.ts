import { describe, expect, it } from "vitest";
import { buildResponseToolMessages } from "./task-message-display-tools.js";

function messageWithCall(name: string) {
  return {
    id: "message-1",
    role: "assistant",
    created_at: "2026-11-18T00:00:00Z",
    content_json: {
      text: "Training is still running.",
      response_items: [
        { type: "function_call", call_id: "call-1", name, arguments: "{}" },
        { type: "function_call_output", call_id: "call-1", output: "{}" }
      ]
    }
  } as unknown as Parameters<typeof buildResponseToolMessages>[0];
}

describe("buildResponseToolMessages", () => {
  it("does not repeat a posted message as tool activity", () => {
    expect(buildResponseToolMessages(messageWithCall("send_message"))).toEqual([]);
  });

  it("keeps ordinary tool calls as activity", () => {
    expect(buildResponseToolMessages(messageWithCall("run_shell")).map((message) => message.content_json.tool)).toEqual(["run_shell"]);
  });
});
