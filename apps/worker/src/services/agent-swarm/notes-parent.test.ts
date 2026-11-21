import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

const mockClient = { query: vi.fn() };

vi.mock("../../lib/db.js", () => ({
  withTransaction: vi.fn(async <T>(fn: (client: PoolClient) => Promise<T>) => fn(mockClient as unknown as PoolClient))
}));
vi.mock("./scheduler.js", () => ({ lockSwarmInTx: vi.fn(async () => ({ config_json: {} })) }));
vi.mock("./barrier.js", () => ({ wakeParentIfBarrierMetInTx: vi.fn(async () => true) }));
vi.mock("./events.js", () => ({ emitSwarmEvent: vi.fn(async () => {}) }));
vi.mock("./lane-store.js", () => ({ countActiveChildrenInTx: vi.fn(async () => 2) }));

const { wakeParentIfBarrierMetInTx } = await import("./barrier.js");
const { countActiveChildrenInTx } = await import("./lane-store.js");
const { insertSwarmNote } = await import("./notes-store.js");
const { claimParentShareNoteItemsInTx } = await import("./notes-delivery.js");

describe("parent share note inbox and wakeups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("records notify_siblings and wakes a parked parent only when notifyParent is wake", async () => {
    await expect(insertSwarmNote({
      swarmTaskId: "swarm-1", authorTaskId: "lane-1", scopeParentTaskId: "parent-1",
      kind: "shared", content: "Parent-only FYI", notifySiblings: false, notifyParent: "inbox"
    })).resolves.toEqual({ parentWoken: false });
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("notify_siblings, notify_parent"),
      ["swarm-1", "lane-1", "parent-1", "shared", "Parent-only FYI", false, "inbox"]
    );
    expect(wakeParentIfBarrierMetInTx).not.toHaveBeenCalled();

    await expect(insertSwarmNote({
      swarmTaskId: "swarm-1", authorTaskId: "lane-1", scopeParentTaskId: "parent-1",
      kind: "shared", content: "Plan invalid", notifySiblings: true, notifyParent: "wake"
    })).resolves.toEqual({ parentWoken: true });
    expect(wakeParentIfBarrierMetInTx).toHaveBeenCalledWith(mockClient, "parent-1");
  });

  it("claims undelivered parent share notes once and includes wake guidance when lanes are active", async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [
          { seq: "10", author_task_id: "lane-a", author_title: "Research", content: "API is deprecated.", notify_parent: "inbox" },
          { seq: "11", author_task_id: "lane-b", author_title: "Design", content: "Need pivot.", notify_parent: "wake" }
        ],
        rowCount: 2
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 });
    vi.mocked(countActiveChildrenInTx).mockResolvedValueOnce(2);

    const items = await claimParentShareNoteItemsInTx(mockClient as unknown as PoolClient, "parent-1");
    expect(items).toHaveLength(1);
    const content = (items[0] as { content: string }).content;
    expect(content).toContain("lane_id lane-a");
    expect(content).toContain("API is deprecated.");
    expect(content).toContain("lane_id lane-b");
    expect(content).toContain("[urgent]");
    expect(content).toContain("Need pivot.");
    expect(content).toContain("wait with lanes true");
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining("SET parent_delivered_at = now()"),
      [["10", "11"]]
    );
  });
});
