import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("./messages.js", () => ({ getNewestLeafMessageId: vi.fn() }));
vi.mock("../tasks/task-history.js", () => ({ ensureTaskHistoryWarm: vi.fn() }));
vi.mock("@meowbert/shared", async (original) => ({
  ...await original<typeof import("@meowbert/shared")>(), loadConversationPublicIndex: vi.fn(), loadConversationNavigation: vi.fn()
}));
import { query } from "../../lib/db.js";
import { loadConversationNavigation, loadConversationPublicIndex } from "@meowbert/shared";
import { readOrganizedTaskHistory } from "./conversation-history.js";

const ids = Array.from({ length: 6 }, (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const context = { taskId: ids[0], environmentId: "project", branchLeafId: ids[4], allowOtherTasks: false };
const messages = ids.slice(1, 5).map((id) => ({ id, role: "assistant", text: id, summary: null, parent_message_id: null, created_at: "" }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadConversationPublicIndex).mockResolvedValue(messages);
  vi.mocked(query).mockImplementation(async (sql, params) => ({ rows: sql.includes("WITH ORDINALITY")
    ? messages.filter((message) => (params?.[1] as string[]).includes(message.id)) : [{ id: ids[0], title: "Lesson", status: "completed" }]
  } as never));
});

describe("organized public history", () => {
  it("paginates stable public IDs without repeating messages", async () => {
    const first = await readOrganizedTaskHistory({ max_messages: 2 }, context);
    expect(first).toMatchObject({ messages: messages.slice(0, 2), next_cursor: ids[2] });
    expect(await readOrganizedTaskHistory({ max_messages: 2, cursor: ids[2] }, context))
      .toMatchObject({ messages: messages.slice(2), next_cursor: null });
  });
  it("reads exact messages only on the selected branch", async () => {
    expect(await readOrganizedTaskHistory({ message_ids: [ids[3]] }, context)).toMatchObject({ messages: [messages[2]], next_cursor: null });
    await expect(readOrganizedTaskHistory({ message_ids: [ids[5]] }, context)).rejects.toThrow("not in this conversation branch");
    await expect(readOrganizedTaskHistory({ cursor: ids[5] }, context)).rejects.toThrow("Cursor");
  });
  it("does not expand cross-task access when memory is disabled", async () => {
    await expect(readOrganizedTaskHistory({ task_id: ids[5] }, context)).rejects.toThrow("Cross-task");
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects branch IDs from another task", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: ids[0] }] } as never).mockResolvedValueOnce({ rows: [] } as never);
    await expect(readOrganizedTaskHistory({ branch_leaf_id: ids[5] }, context)).rejects.toThrow("branch not found");
  });
  it("reads staged outline changes after context rollover without exposing them on other branches", async () => {
    vi.mocked(loadConversationNavigation).mockImplementation(async () => ({ enabled: true, active_leaf_message_id: ids[4],
      outline: { markdown: "Saved", message_id: ids[2] }, map: null, turns: [], messages: [] }));
    const staged = { outline: "Updated", graph: null, outlineChanged: true, mapChanged: false };
    expect(await readOrganizedTaskHistory({ view: "navigation" }, { ...context, staged }))
      .toMatchObject({ outline: { markdown: "Updated", message_id: "current" } });
    expect(await readOrganizedTaskHistory({ view: "navigation", branch_leaf_id: ids[2] }, { ...context, staged }))
      .toMatchObject({ outline: { markdown: "Saved" } });
  });
});
