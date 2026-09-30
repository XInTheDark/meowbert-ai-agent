import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { reclaimCancelledSwarmBudgetInTx } from "./agent-swarm-budget-reclaim.js";

describe("cancelled Swarm budget reclaim", () => {
  it("returns only unspent, unreserved branch and outer-seat tokens", async () => {
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT unassigned_tokens")) {
        return { rows: [
          { unassigned_tokens: 8_000, system_reserve_tokens: 2_000 },
          { unassigned_tokens: 3_000, system_reserve_tokens: 1_000 }
        ] };
      }
      if (sql.includes("SELECT m.node_id")) {
        return { rows: [{ node_id: "parent", workflow_agent_id: "leader", lease_tokens: 10_000, spent_tokens: 3_000, reserved_tokens: 1_000 }] };
      }
      if (sql.includes("FROM task_workflow_swarm_node_members") && sql.includes("WHERE node_id = ANY")) {
        return { rows: [
          { node_id: "child", workflow_agent_id: "leader", lease_tokens: 12_000, spent_tokens: 5_000, reserved_tokens: 2_000 },
          { node_id: "grandchild", workflow_agent_id: "worker", lease_tokens: 9_000, spent_tokens: 4_000, reserved_tokens: 0 }
        ] };
      }
      return { rows: [] };
    });

    const released = await reclaimCancelledSwarmBudgetInTx({ query } as unknown as PoolClient, {
      workflowTaskId: "workflow", parentNodeId: "parent", cancelledNodeIds: ["child", "grandchild"]
    });

    expect(released).toBe(30_000);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("unassigned_tokens = unassigned_tokens + $2"), ["parent", 30_000]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("'reclaim'"), ["workflow", "child", "parent", 30_000]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'cancelled'"), [["child", "grandchild"], "parent"]);
  });
});
