import { describe, expect, it } from "vitest";
import type { TaskMessage } from "../../lib/types";
import { buildConversationDisplayEntries } from "./conversationActivityEntries";
import { buildConversationRenderItems, type ConversationRenderItem } from "./conversationTurnFolds";

function message(id: string, role: TaskMessage["role"], content_json: TaskMessage["content_json"], second = 0): TaskMessage {
  return { id, role, content_json, created_at: new Date(Date.UTC(2026, 8, 11, 0, 0, second)).toISOString(),
    parent_message_id: null, edited_from_message_id: null };
}

const tool = (id: string): TaskMessage => message(id, "tool", { tool: "run_shell", callId: id, durationMs: 100 });
const retry = (id: string): TaskMessage => message(id, "system", { text: "Model request failed (attempt 1/6): Timeout. Retrying in 3s..." });
const artifact = (id: string): TaskMessage => message(id, "tool", {
  inline_artifact: { type: "image", relative_path: `${id}.png`, mime_type: "image/png" }
});

function describeItems(items: ConversationRenderItem[]): string[] {
  return items.map((item) => {
    if (item.kind === "fold") {
      return `fold(${item.fold.title}, ${item.fold.callCount}):[${describeItems(item.fold.items).join(", ")}]`;
    }
    const { entry } = item;
    const label = entry.kind === "message" ? entry.message.id : entry.kind;
    return item.activityPart ? `${label}/${item.activityPart}` : label;
  });
}

const swarmTurn = [
  message("ask", "user", { text: "Do it" }, 0), tool("one"),
  message("waiting", "assistant", { text: "Waiting for Worker 1." }, 5), retry("retry"), tool("two"), artifact("chart"),
  tool("three"), message("answer", "assistant", { text: "Done." }, 75)
];

describe("finished turn folds", () => {
  it("folds interim work of a finished turn while keeping artifacts, notices and the answer visible", () => {
    const items = buildConversationRenderItems(buildConversationDisplayEntries(swarmTurn), { foldFinishedTurns: true, isTaskRunning: false });
    expect(describeItems(items)).toEqual([
      "ask",
      "fold(Worked for 75s, 3):[activity/tools, waiting, activity/tools, activity/tools]",
      "activity/notices", "artifact", "answer"
    ]);
  });

  it("leaves the trailing turn of a running task and non-swarm conversations unfolded", () => {
    const entries = buildConversationDisplayEntries(swarmTurn);
    const running = buildConversationRenderItems(entries, { foldFinishedTurns: true, isTaskRunning: true });
    const disabled = buildConversationRenderItems(entries, { foldFinishedTurns: false, isTaskRunning: false });
    expect(running.every((item) => item.kind === "entry")).toBe(true);
    expect(disabled.every((item) => item.kind === "entry")).toBe(true);
  });

  it("does not add a fold layer over a single activity group", () => {
    const entries = buildConversationDisplayEntries([message("ask", "user", { text: "Hi" }), tool("one"),
      message("answer", "assistant", { text: "Hello." })]);
    const items = buildConversationRenderItems(entries, { foldFinishedTurns: true, isTaskRunning: false });
    expect(describeItems(items)).toEqual(["ask", "activity", "answer"]);
  });
});
