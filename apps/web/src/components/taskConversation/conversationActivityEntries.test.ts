import { describe, expect, it } from "vitest";
import type { TaskMessage } from "../../lib/types";
import { buildConversationDisplayEntries, getConversationActivityGroups } from "./conversationActivityEntries";
import { buildStableHistoricalToolGroupDescriptors, resolveToolInspectorSelection } from "./shared";

function message(id: string, role: TaskMessage["role"], content_json: TaskMessage["content_json"]): TaskMessage {
  return { id, role, content_json, created_at: "2026-09-11T00:00:00.000Z", parent_message_id: null, edited_from_message_id: null };
}

const tool = (id: string): TaskMessage => message(id, "tool", { tool: "run_shell", callId: id, durationMs: 100 });
const retry = (id: string): TaskMessage => message(id, "system", { text: "Model request failed (attempt 1/6): Timeout. Retrying in 3s..." });
const response = (id: string, callId: string, text = ""): TaskMessage => message(id, "assistant", { text, response_items: [
  { type: "function_call", call_id: callId, name: "view_image", arguments: "{}" },
  { type: "function_call_output", call_id: callId, output: "image shown" }
] });

describe("conversation activity consolidation", () => {
  it("merges tool records and response tools across retries, recovery notices, and empty assistants", () => {
    const recovery = message("recovery", "system", { text: "[System: Recovered missing tool output for function call call_2.]" });
    const messages = [tool("call_1"), retry("retry"), response("empty", "call_2"), recovery, tool("call_3"),
      response("final", "call_3", "Done.")];
    const snapshot = JSON.stringify(messages);
    const entries = buildConversationDisplayEntries(messages);
    const [group] = getConversationActivityGroups(messages);
    expect(entries.map((entry) => entry.kind)).toEqual(["activity", "message"]);
    expect(group.toolGroup.map((item) => item.content_json.callId)).toEqual(["call_1", "call_2", "call_3"]);
    expect(group.notices.map((item) => item.id)).toEqual(["retry", "recovery"]);
    expect(JSON.stringify(messages)).toBe(snapshot);
  });

  it("keeps visible messages, artifacts, and checkpoints as activity boundaries", () => {
    const messages = [tool("first"), message("commentary", "assistant", { text: "Checking the image." }), tool("second"),
      message("image", "tool", { inline_artifact: { type: "image", relative_path: "image.png", mime_type: "image/png" } }),
      tool("third"), message("checkpoint", "system", { kind: "context_checkpoint", checkpoint: "Saved", text: "Checkpoint" }),
      tool("fourth"), message("user", "user", { text: "Continue" }), tool("fifth")];
    expect(buildConversationDisplayEntries(messages).map((entry) => entry.kind)).toEqual([
      "activity", "message", "activity", "artifact", "activity", "message", "activity", "message", "activity"
    ]);
  });

  it("keeps multiple reasoning summaries in one activity group", () => {
    const thought = (id: string, text: string) => message(id, "assistant", { text: "", response_items: [
      { type: "reasoning", summary: [{ type: "summary_text", text }] }
    ] });
    const groups = getConversationActivityGroups([tool("first"), thought("a", "First thought"), retry("retry"),
      tool("second"), thought("b", "Second thought")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].thoughts.map((item) => item.content)).toEqual(["First thought", "Second thought"]);
  });

  it("deduplicates replayed response calls by their exact call ID", () => {
    const [group] = getConversationActivityGroups([response("a", "one"), retry("retry"), response("b", "one"), response("c", "two")]);
    expect(group.toolGroup.map((item) => item.content_json.callId)).toEqual(["one", "two"]);
  });

  it("keeps the latest output when a response call is replayed after recovery", () => {
    const first = response("a", "one");
    const completed = response("b", "one");
    (completed.content_json.response_items as Array<Record<string, unknown>>)[1].output = "Completed output";
    const [group] = getConversationActivityGroups([first, retry("retry"), completed]);
    expect(group.toolGroup).toHaveLength(1);
    expect(group.toolGroup[0].id).toBe("a:response-tool:one");
    expect(group.toolGroup[0].content_json.response_function_output).toMatchObject({ output: "Completed output" });
  });

  it("updates an open inspector with merged calls and hydrated output", () => {
    const first = tool("first");
    const hydrated = { ...first, content_json: { ...first.content_json, stdout: "Full output" } };
    const messages = [hydrated, retry("retry"), response("a", "second"), tool("third")];
    const resolved = resolveToolInspectorSelection({ kind: "historical", groupKey: "tool-group:first", toolGroup: [first] }, messages, []);
    expect(resolved?.kind).toBe("historical");
    if (resolved?.kind !== "historical") return;
    expect(resolved.toolGroup).toHaveLength(3);
    expect(resolved.toolGroup[0].content_json.stdout).toBe("Full output");
  });

  it("preserves group identity and refreshes error lists after the visible window slides", () => {
    const first = tool("first");
    const notice = retry("notice");
    const second = tool("second");
    const initial = buildStableHistoricalToolGroupDescriptors([first, notice, second], [], 0);
    const next = buildStableHistoricalToolGroupDescriptors([notice, second, retry("new")], initial.descriptors, initial.nextCounter);
    expect(next.descriptors[0].key).toBe(initial.descriptors[0].key);
    const selected = resolveToolInspectorSelection({ kind: "historical", groupKey: "tool-group:first", toolGroup: [],
      view: "notices", notices: [notice] }, [notice, second, retry("new")], []);
    expect(selected?.kind === "historical" && selected.notices?.map((item) => item.id)).toEqual(["notice", "new"]);
  });
});
