import { toDisplayTaskMessage } from "@meowbert/shared/task-message-display";
import { describe, expect, it } from "vitest";
import type { TaskMessage } from "../../lib/types";
import { getConversationActivityGroups } from "./conversationActivityEntries";
import { buildActivityTimeline } from "./activityTimeline";

function message(id: string, role: TaskMessage["role"], content_json: TaskMessage["content_json"]): TaskMessage {
  return toDisplayTaskMessage({ id, role, content_json, created_at: "2026-09-11T00:00:00.000Z", parent_message_id: null, edited_from_message_id: null });
}

const tool = (callId: string): TaskMessage => message(callId, "tool", { tool: "run_shell", callId, durationMs: 100 });
const reasoning = (text: string) => ({ type: "reasoning", summary: [{ type: "summary_text", text }] });
const call = (callId: string) => ({ type: "function_call", call_id: callId, name: "run_shell", arguments: "{}" });

describe("activity timeline", () => {
  it("places each thought before the tool call it preceded and merges adjacent thoughts", () => {
    const [group] = getConversationActivityGroups([tool("a"), tool("b"), message("reply", "assistant", { text: "", response_items: [
      reasoning("Plan"), reasoning("Look first"), call("a"), reasoning("Now run b"), call("b"), reasoning("Wrap up")
    ] })]);
    const timeline = buildActivityTimeline(group.toolGroup, group.thoughts).map((entry) => (
      entry.kind === "tool" ? `tool:${entry.tool.id}` : `thought:${entry.thoughts.map((thought) => thought.content).join("+")}`
    ));
    expect(timeline).toEqual(["thought:Plan+Look first", "tool:a", "thought:Now run b", "tool:b", "thought:Wrap up"]);
  });
});
