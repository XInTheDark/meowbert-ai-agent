import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(), withTransaction: vi.fn()
}));

vi.mock("@meowbert/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@meowbert/shared")>();
  return {
    ...actual,
    touchTaskHistoryActivity: vi.fn(async () => {})
  };
});

import { query, withTransaction } from "../../lib/db.js";
import { appendMessage } from "./messages.js";

describe("appendMessage", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({
      command: "INSERT",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [{ id: "message-1" }]
    });
  });

  it("stores the agent id in assistant message metadata", async () => {
    await appendMessage(
      "task-1",
      "assistant",
      { text: "done" },
      {
        parentMessageId: "user-1",
        createdAt: "2026-05-03T12:00:00.000Z",
        agentId: "default",
        reasoningContentCount: 0
      }
    );

    const insertParams = mockedQuery.mock.calls[0]?.[1];
    expect(insertParams?.[3]).toBe(JSON.stringify({
      message_time: "2026-05-03T12:00:00.000Z",
      agent_id: "default",
      reasoning_content_count: 0
    }));
  });

  it("saves a reply and resolved snapshots using the same transaction", async () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const transactionQuery = vi.fn(async () => ({ rows: [{ id }] }));
    vi.mocked(withTransaction).mockImplementation(async (fn) => fn({ query: transactionQuery } as never));
    await appendMessage("task", "assistant", { text: "Done", turn_summary: "Finish lesson" }, { organizationSnapshots: [
      { kind: "outline", payload_json: { markdown: "[Lesson](#message-current)" } },
      { kind: "map", payload_json: { nodes: [{ id: "current", parent_id: null, topic_id: null }], topics: [], main_path_end_id: "current" } }
    ] });
    expect(withTransaction).toHaveBeenCalled();
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(transactionQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO task_conversation_snapshots"),
      ["task", id, "outline", JSON.stringify({ markdown: `[Lesson](#message-${id})` })]);
    expect(transactionQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO task_conversation_snapshots"),
      ["task", id, "map", JSON.stringify({ topics: [], main_path_end_id: id, nodes: [{ id, parent_id: null, topic_id: null }] })]);
  });

  it("propagates a snapshot failure to the transaction rollback boundary", async () => {
    const transactionQuery = vi.fn().mockResolvedValueOnce({ rows: [{ id: "message" }] }).mockRejectedValueOnce(new Error("snapshot failure"));
    vi.mocked(withTransaction).mockImplementation(async (fn) => fn({ query: transactionQuery } as never));
    await expect(appendMessage("task", "assistant", { text: "Done" }, { organizationSnapshots: [
      { kind: "outline", payload_json: { markdown: "Outline" } }
    ] })).rejects.toThrow("snapshot failure");
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
