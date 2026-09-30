import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { grantSwarmWorkerLeaseInTx, prepareSwarmWorkerLeaseInTx } from "./agent-swarm-worker-lease.js";

function clientWithLease(unassignedTokens: number) {
  const query = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT n.id AS node_id")) {
      return { rows: [{ node_id: "node", node_status: "active", member_status: "paused",
        workflow_agent_id: "worker", lease_tokens: 8_192, spent_tokens: 8_192,
        reserved_tokens: 0, unassigned_tokens: unassignedTokens }] };
    }
    return { rows: [] };
  });
  return { query } as unknown as PoolClient & { query: typeof query };
}

describe("Swarm worker lease resume", () => {
  it("takes one inference step from the node pool before resuming an exhausted worker", async () => {
    const client = clientWithLease(10_000);
    await prepareSwarmWorkerLeaseInTx(client, {
      workflowTaskId: "workflow", nodeKey: "node-key", workerTaskId: "worker-task"
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("unassigned_tokens = unassigned_tokens - $2"), ["node", 8_192]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'active'"), ["node", "worker", 8_192]);
  });

  it("rejects a resume when the node cannot fund another step", async () => {
    const client = clientWithLease(500);
    await expect(prepareSwarmWorkerLeaseInTx(client, {
      workflowTaskId: "workflow", nodeKey: "node-key", workerTaskId: "worker-task"
    })).rejects.toThrow("needs 8192 more weighted tokens");
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("SET lease_tokens"))).toBe(false);
  });

  it("uses a funded child node's own lease for its leader", async () => {
    const client = clientWithLease(10_000);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT n.id AS node_id")) {
        return { rows: [{ node_id: "node", node_status: "active", member_status: "paused",
          workflow_agent_id: "worker", lease_tokens: 8_192, spent_tokens: 8_192,
          reserved_tokens: 0, unassigned_tokens: 10_000 }] };
      }
      if (sql.includes("SELECT id, status FROM task_workflow_swarm_nodes")) {
        return { rows: [{ id: "child", status: "active" }] };
      }
      return { rows: [] };
    });
    await prepareSwarmWorkerLeaseInTx(client, {
      workflowTaskId: "workflow", nodeKey: "node-key", workerTaskId: "child-leader-task"
    });
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("SET lease_tokens"))).toBe(false);
  });
});

describe("Swarm worker budget grants", () => {
  it("moves the leader's chosen amount from the node pool into the worker's lease and reactivates it", async () => {
    const client = clientWithLease(5_000_000);
    await grantSwarmWorkerLeaseInTx(client, {
      workflowTaskId: "workflow", nodeKey: "node-key", workerTaskId: "worker-task", tokens: 3_000_000
    });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("unassigned_tokens = unassigned_tokens - $2"), ["node", 3_000_000]);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("SET lease_tokens = lease_tokens + $3"), ["node", "worker", 3_000_000]);
  });

  it("rejects a grant larger than the node's unassigned pool", async () => {
    const client = clientWithLease(1_000_000);
    await expect(grantSwarmWorkerLeaseInTx(client, {
      workflowTaskId: "workflow", nodeKey: "node-key", workerTaskId: "worker-task", tokens: 3_000_000
    })).rejects.toThrow("this node has 1000000 unassigned");
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("SET lease_tokens"))).toBe(false);
  });
});
