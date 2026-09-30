import { describe, expect, it } from "vitest";
import type { TaskMessage } from "../lib/types";
import { buildConversationDisplayEntries } from "../components/taskConversation/conversationActivityEntries";
import { getManagedTaskCard, getRunInboxReportCards } from "./managedTaskCards";

const TASK_ID = "6f1f0c5e-3f2a-4a53-9a55-0f0c8b3f6d11";

function toolMessage(id: string, tool: string, output: unknown, inputText = "Fix the bug"): TaskMessage {
  return {
    id,
    role: "tool",
    created_at: "2026-09-29T00:00:00.000Z",
    content_json: {
      tool,
      callId: `call-${id}`,
      inputText,
      response_function_output: { call_id: `call-${id}`, output: JSON.stringify(output) }
    }
  } as unknown as TaskMessage;
}

describe("Master task cards", () => {
  it("shows a card for a created task and for a message that started an idle task", () => {
    expect(getManagedTaskCard(toolMessage("a", "create_task", { task_id: TASK_ID, listening: true })))
      .toEqual({ taskId: TASK_ID, action: "created", fallbackTitle: "Fix the bug" });
    expect(getManagedTaskCard(toolMessage("b", "message_task", { task_id: TASK_ID, delivery: "started", listening: true })))
      .toEqual({ taskId: TASK_ID, action: "started", fallbackTitle: null });
  });

  it("ignores follow-ups to running tasks and failed calls", () => {
    expect(getManagedTaskCard(toolMessage("a", "message_task", { task_id: TASK_ID, delivery: "queued_for_running_task" }))).toBeNull();
    expect(getManagedTaskCard(toolMessage("b", "create_task", { error: "nope" }))).toBeNull();
  });

  it("replaces the tool activity entry with a card entry in the conversation", () => {
    const entries = buildConversationDisplayEntries([
      toolMessage("a", "query_tasks", { tasks: [] }),
      toolMessage("b", "create_task", { task_id: TASK_ID, listening: true })
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual(["activity", "managed-task"]);
  });

  it("shows delivered task reports as cards instead of empty bubbles", () => {
    const inbox = (items: unknown[]) => ({
      id: "r1", role: "system", created_at: "2026-09-29T00:00:00.000Z",
      content_json: { text: "", response_items: items }
    }) as unknown as TaskMessage;
    const report = { role: "user", content: `[Task report] "Fix #75" (${TASK_ID}) finished: succeeded\nDone.` };

    expect(getRunInboxReportCards(inbox([report]))).toEqual([{ taskId: TASK_ID, action: "reported", fallbackTitle: "Fix #75" }]);
    expect(getRunInboxReportCards(inbox([{ role: "user", content: "[Subagent note]\nhi" }]))).toEqual([]);
    expect(buildConversationDisplayEntries([inbox([report])]).map((entry) => entry.kind)).toEqual(["managed-task"]);
    expect(buildConversationDisplayEntries([inbox([{ role: "user", content: "[Subagent note]\nhi" }])])).toEqual([]);
  });
});
