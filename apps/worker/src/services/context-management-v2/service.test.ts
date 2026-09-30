import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../../lib/db.js", () => ({
  query: mocks.query,
  withTransaction: mocks.withTransaction
}));

import { recordContextItems, resolveContextManagementState } from "./service.js";

describe("Context Management V2 service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a non-reserved alias when loading the latest context window", async () => {
    const transactionClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ version: "v2" }] })
    };
    mocks.withTransaction.mockImplementationOnce(async (callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "visible-node-1" }] })
      .mockResolvedValueOnce({
        rows: [{
          id: "window-1",
          context_node_id: "context-node-1",
          parent_window_id: null,
          branch_leaf_message_id: null,
          ordinal: 1
        }]
      })
      .mockResolvedValueOnce({ rows: [{ id: "window-1" }] })
      .mockResolvedValueOnce({ rows: [] });

    await resolveContextManagementState({
      taskId: "11111111-1111-1111-1111-111111111111",
      requestedVersion: "v2",
      runtimeModel: "gpt-test",
      branchLeafMessageId: null,
      seedItems: []
    });

    const latestWindowQuery = mocks.query.mock.calls[1]?.[0] as string;
    expect(latestWindowQuery).toContain("FROM task_context_windows context_window");
    expect(latestWindowQuery).not.toContain("FROM task_context_windows window");
  });

  it("skips old window history when a clear will replace it", async () => {
    const transactionClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ version: "v2" }] })
    };
    mocks.withTransaction.mockImplementationOnce(async (callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));
    mocks.query
      .mockResolvedValueOnce({ rows: [{ id: "visible-node-1" }] })
      .mockResolvedValueOnce({ rows: [{
        id: "window-1",
        context_node_id: "context-node-1",
        parent_window_id: null,
        branch_leaf_message_id: null,
        ordinal: 1
      }] })
      .mockResolvedValueOnce({ rows: [{ id: "window-1" }] });

    const result = await resolveContextManagementState({
      taskId: "11111111-1111-1111-1111-111111111111",
      requestedVersion: "v2",
      runtimeModel: "gpt-test",
      branchLeafMessageId: null,
      seedItems: [],
      skipHistoryReplay: true
    });

    expect(result.conversationItems).toEqual([]);
    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("task_context_history_items"))).toBe(false);
  });

  it("writes large history in bounded batches with consecutive ordinals and replay markers", async () => {
    const transactionClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "window-1" }] })
        .mockResolvedValueOnce({ rows: [{ ordinal: 5 }] })
        .mockResolvedValue({ rows: [] })
    };
    mocks.withTransaction.mockImplementationOnce(async (callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));
    const items = Array.from({ length: 257 }, (_, index) => ({ role: "user" as const, content: `item ${index}` }));

    await recordContextItems({
      version: "v2",
      taskId: "11111111-1111-1111-1111-111111111111",
      firstWindowId: "window-1",
      windowId: "window-1",
      contextNodeId: "22222222-2222-2222-2222-222222222222",
      previousWindowId: null,
      branchLeafMessageId: null,
      reminderSent: false,
      pendingReset: false,
      recoveryPhase: "normal"
    }, items);

    const inserts = transactionClient.query.mock.calls.slice(2);
    expect(inserts).toHaveLength(3);
    expect(inserts.every(([sql]) => String(sql).includes("jsonb_to_recordset"))).toBe(true);
    const rows = inserts.flatMap(([, params]) => JSON.parse(params[3] as string));
    expect(rows).toHaveLength(257);
    expect(rows.map((row: { ordinal: number }) => row.ordinal)).toEqual(Array.from({ length: 257 }, (_, index) => index + 6));
    expect(rows[0].payload_json.content).toMatch(/^item 0\n\[id: [0-9a-f-]+\]$/);
    expect(items[0].content).toBe(rows[0].payload_json.content);
  });
});
