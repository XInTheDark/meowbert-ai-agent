import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { reclaimCancelledSwarmBudgetInTx } from "./agent-swarm-budget-reclaim.js";

describe("cancelled Swarm budget reclaim", () => {
  it("returns the pools and reserves of cancelled nodes to the parent", async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT unassigned_tokens")) {
        return { rows: [
          { unassigned_tokens: 8_000, system_reserve_tokens: 2_000 },
          { unassigned_tokens: 3_000, system_reserve_tokens: 1_000 }
        ] };
      }
      return { rows: [] };
    });

    const released = await reclaimCancelledSwarmBudgetInTx({ query } as unknown as PoolClient, {
      workflowTaskId: "workflow", parentNodeId: "parent", cancelledNodeIds: ["child", "grandchild"]
    });

    expect(released).toBe(14_000);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("unassigned_tokens = unassigned_tokens + $2"), ["parent", 14_000]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("'reclaim'"), ["workflow", "child", "parent", 14_000]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'cancelled'"), [["child", "grandchild"], "parent"]);
  });
});
