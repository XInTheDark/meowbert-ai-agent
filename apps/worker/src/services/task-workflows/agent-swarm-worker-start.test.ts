import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { assertSwarmWorkerCanStartInTx } from "./agent-swarm-worker-start.js";

function clientWithPool(unassignedTokens: number) {
  return {
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("n.unassigned_tokens")) {
        return { rows: [{ node_id: "node-1", node_status: "active", member_status: "paused", unassigned_tokens: unassignedTokens }] };
      }
      if (sql.includes("FROM user_token_usage_events")) return { rows: [{ weighted_tokens: 90_000 }] };
      return { rows: [] };
    })
  } as unknown as PoolClient;
}

const input = { workflowTaskId: "workflow-1", nodeKey: "node-0", workerTaskId: "worker-task" };

describe("starting a Swarm worker", () => {
  it("starts a worker the shared pool can fund", async () => {
    await expect(assertSwarmWorkerCanStartInTx(clientWithPool(500_000), input)).resolves.toBeUndefined();
  });

  it("refuses to start a worker once the pool cannot fund its next step", async () => {
    await expect(assertSwarmWorkerCanStartInTx(clientWithPool(50_000), input)).rejects.toThrow("shared budget is spent");
  });
});
